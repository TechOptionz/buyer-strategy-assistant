import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { type DB, schema } from "../db";
import type { FactValueState, SourceType } from "../db/schema";
import { conflict, invalid, notFound } from "../http";
import { isValidPath, labelFor, validateValue } from "../profile/fields";
import { deriveProfile, type FactLike, ProfileView, profileSnapshot } from "../profile/state";

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Conn = DB | Tx;

export async function loadFacts(db: Conn, assessmentId: string): Promise<FactLike[]> {
  const rows = await db.select().from(schema.facts).where(eq(schema.facts.assessmentId, assessmentId)).orderBy(asc(schema.facts.createdAt));
  return rows.map((r) => ({ ...r, value: r.value }));
}

export async function loadView(db: Conn, assessmentId: string) {
  return new ProfileView(deriveProfile(await loadFacts(db, assessmentId)));
}

/**
 * Bump the assessment revision with optimistic concurrency and snapshot the confirmed profile.
 * Stale edits (expectedRevision ≠ current) fail with 409 (AT16).
 */
export async function bumpRevision(
  tx: Tx,
  ctx: AuthContext,
  assessmentId: string,
  expectedRevision: number,
  changedPaths: string[],
  summary: string,
) {
  const updated = await tx
    .update(schema.assessments)
    .set({ currentRevision: sql`${schema.assessments.currentRevision} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.currentRevision, expectedRevision)))
    .returning({ revision: schema.assessments.currentRevision });
  if (!updated.length) throw conflict("This profile was changed by someone else. Reload to see the latest version before saving.");
  const revision = updated[0].revision;
  const view = await loadView(tx, assessmentId);
  await tx.insert(schema.profileRevisions).values({
    organisationId: ctx.organisationId,
    assessmentId,
    revision,
    snapshot: profileSnapshot(view.state),
    changedPaths: [...new Set(changedPaths)],
    changeSummary: summary,
    createdById: ctx.userId,
  });
  return revision;
}

export interface FieldEntry {
  path: string;
  valueState: FactValueState;
  value?: unknown;
}

export function validateEntry(e: FieldEntry): unknown {
  if (!isValidPath(e.path)) throw invalid(`Unknown field ${e.path}`, { [e.path]: "Unknown field" });
  if (e.valueState !== "value") return null;
  const v = validateValue(e.path, e.value);
  if (!v.ok) throw invalid(`${labelFor(e.path)}: ${v.error}`, { [e.path]: v.error });
  return v.value;
}

/**
 * Directly set confirmed values (structured entry / guided answers / explicit edits). A person
 * supplying a value is a deliberate decision, so earlier confirmed values for that path are
 * superseded (kept for history), which also resolves any conflict on that path.
 */
export async function setConfirmedFields(
  db: DB,
  ctx: AuthContext,
  assessmentId: string,
  expectedRevision: number,
  entries: FieldEntry[],
  source: { type: SourceType; id?: string | null; evidence?: string | null },
  correlationId: string,
) {
  if (!entries.length) throw invalid("No fields supplied");
  const values = entries.map((e) => ({ e, value: validateEntry(e) }));
  return db.transaction(async (tx) => {
    const now = new Date();
    for (const { e, value } of values) {
      await tx
        .update(schema.facts)
        .set({ status: "superseded" })
        .where(and(eq(schema.facts.assessmentId, assessmentId), eq(schema.facts.fieldPath, e.path), inArray(schema.facts.status, ["confirmed", "proposed"])));
      await tx.insert(schema.facts).values({
        organisationId: ctx.organisationId,
        assessmentId,
        fieldPath: e.path,
        valueState: e.valueState,
        value: value as never,
        sourceType: source.type,
        sourceId: source.id ?? null,
        evidenceText: source.evidence ?? null,
        status: "confirmed",
        revision: expectedRevision + 1,
        proposedBy: "agent",
        confirmedById: ctx.userId,
        confirmedAt: now,
      });
    }
    const paths = entries.map((e) => e.path);
    const revision = await bumpRevision(tx, ctx, assessmentId, expectedRevision, paths, `Set ${paths.length} field(s)`);
    await audit(tx, ctx, { action: "profile.set", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { paths, revision } });
    return revision;
  });
}

/**
 * Confirm proposed facts (optionally with an edited value). Confirming a value that differs from an
 * existing confirmed value does NOT overwrite it: both stay confirmed and the path becomes a
 * conflict until a person resolves it (INT04, AT02).
 */
export async function confirmFacts(
  db: DB,
  ctx: AuthContext,
  assessmentId: string,
  expectedRevision: number,
  items: { factId: string; value?: unknown }[],
  correlationId: string,
) {
  if (!items.length) throw invalid("No facts selected");
  return db.transaction(async (tx) => {
    const ids = items.map((i) => i.factId);
    const rows = await tx
      .select()
      .from(schema.facts)
      .where(and(eq(schema.facts.assessmentId, assessmentId), inArray(schema.facts.id, ids), eq(schema.facts.status, "proposed")));
    if (rows.length !== ids.length) throw conflict("Some facts were already confirmed or rejected. Reload and try again.");
    const now = new Date();
    for (const item of items) {
      const row = rows.find((r) => r.id === item.factId)!;
      let value = row.value;
      let sourceType = row.sourceType;
      if (item.value !== undefined) {
        value = validateEntry({ path: row.fieldPath, valueState: "value", value: item.value }) as never;
        if (JSON.stringify(value) !== JSON.stringify(row.value)) sourceType = "agent_override";
      } else if (row.valueState === "value") {
        validateEntry({ path: row.fieldPath, valueState: "value", value: row.value });
      }
      await tx
        .update(schema.facts)
        .set({ status: "confirmed", value: value as never, sourceType, confirmedById: ctx.userId, confirmedAt: now, revision: expectedRevision + 1 })
        .where(eq(schema.facts.id, row.id));
    }
    const paths = rows.map((r) => r.fieldPath);
    const revision = await bumpRevision(tx, ctx, assessmentId, expectedRevision, paths, `Confirmed ${rows.length} fact(s)`);
    await audit(tx, ctx, { action: "facts.confirm", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { paths, count: rows.length } });
    return revision;
  });
}

export async function rejectFacts(db: DB, ctx: AuthContext, assessmentId: string, factIds: string[], correlationId: string) {
  if (!factIds.length) throw invalid("No facts selected");
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.facts)
      .set({ status: "rejected" })
      .where(and(eq(schema.facts.assessmentId, assessmentId), inArray(schema.facts.id, factIds), eq(schema.facts.status, "proposed")))
      .returning({ path: schema.facts.fieldPath });
    await audit(tx, ctx, { action: "facts.reject", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { paths: res.map((r) => r.path) } });
  });
}

/** Resolve a conflict by keeping one confirmed fact (others superseded) or supplying a new value. */
export async function resolveConflict(
  db: DB,
  ctx: AuthContext,
  assessmentId: string,
  expectedRevision: number,
  path: string,
  resolution: { keepFactId: string } | { valueState: FactValueState; value?: unknown },
  correlationId: string,
) {
  if ("keepFactId" in resolution) {
    return db.transaction(async (tx) => {
      const [keep] = await tx
        .select()
        .from(schema.facts)
        .where(and(eq(schema.facts.id, resolution.keepFactId), eq(schema.facts.assessmentId, assessmentId), eq(schema.facts.fieldPath, path), eq(schema.facts.status, "confirmed")));
      if (!keep) throw notFound("Fact");
      await tx
        .update(schema.facts)
        .set({ status: "superseded" })
        .where(and(eq(schema.facts.assessmentId, assessmentId), eq(schema.facts.fieldPath, path), eq(schema.facts.status, "confirmed"), sql`${schema.facts.id} <> ${keep.id}`));
      await tx.update(schema.facts).set({ confirmedById: ctx.userId, confirmedAt: new Date() }).where(eq(schema.facts.id, keep.id));
      const revision = await bumpRevision(tx, ctx, assessmentId, expectedRevision, [path], `Resolved conflict on ${path}`);
      await audit(tx, ctx, { action: "conflict.resolve", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { path } });
      return revision;
    });
  }
  return setConfirmedFields(db, ctx, assessmentId, expectedRevision, [{ path, valueState: resolution.valueState, value: resolution.value }], { type: "agent_override" }, correlationId);
}

/** Insert proposed facts from an extraction (not confirmed). */
export async function insertProposed(
  tx: Conn,
  ctx: Pick<AuthContext, "organisationId">,
  assessmentId: string,
  revision: number,
  facts: { path: string; valueState: FactValueState; value: unknown; evidenceText: string; confidence: "high" | "medium" | "low" }[],
  source: { type: SourceType; id: string | null },
  proposedBy: "ai" | "rules",
) {
  if (!facts.length) return [];
  return tx
    .insert(schema.facts)
    .values(
      facts.map((f) => ({
        organisationId: ctx.organisationId,
        assessmentId,
        fieldPath: f.path,
        valueState: f.valueState,
        value: f.value as never,
        sourceType: source.type,
        sourceId: source.id,
        evidenceText: f.evidenceText,
        confidence: f.confidence,
        status: "proposed" as const,
        revision,
        proposedBy,
      })),
    )
    .returning({ id: schema.facts.id });
}
