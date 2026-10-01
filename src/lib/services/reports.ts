import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { loadAssessment } from "../access";
import { AiUnavailableError } from "../ai/anthropic";
import { aiConfig, PROMPT_VERSIONS } from "../ai/config";
import { draftReportWithAi } from "../ai/report";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { type DB, getDb, schema } from "../db";
import type { ScenarioChange, ScenarioResult } from "../finance";
import { conflict, invalid, notFound } from "../http";
import { readiness } from "../interview/engine";
import { assessAreas } from "../market/fit";
import { labelFor } from "../profile/fields";
import { SECTION_KEYS, SECTION_TITLES, validateNarrative, type SectionKey } from "../reports/narrative";
import { buildSnapshot, type ReportSection, type ReportSnapshot, templateSections } from "../reports/snapshot";
import { changedPathsSince, loadEvidence, scenarioStaleness } from "./assessments";
import { loadView } from "./profile";

export interface ReportSections {
  sections: ReportSection[];
  nextActions: { text: string; selected: boolean }[];
}

/** JSON with object keys sorted at every level, so the hash doesn't depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Canonical hash of everything the client sees: snapshot + narrative + commentary + selected actions.
 * Keys are sorted because Postgres jsonb reorders object keys on storage: a hash of the in-memory
 * object would not match the same content read back from the database.
 */
export function reportHash(snapshot: ReportSnapshot, sections: ReportSections) {
  return createHash("sha256").update(canonicalJson({ snapshot, sections })).digest("hex");
}

/**
 * Does stored content match its saved hash? Also accepts the pre-canonical hash of the content as read
 * from the database, which is how reports approved before the canonical hash were fingerprinted.
 */
export function reportMatchesHash(snapshot: ReportSnapshot, sections: ReportSections, hash: string) {
  return reportHash(snapshot, sections) === hash || createHash("sha256").update(JSON.stringify({ snapshot, sections })).digest("hex") === hash;
}

export const CreateReportBody = z.object({
  scenarioIds: z.array(z.string().uuid()).max(3),
  includeAreas: z.boolean(),
  profileRevision: z.number().int().nonnegative(),
});

export async function createReport(ctx: AuthContext, assessmentId: string, body: z.infer<typeof CreateReportBody>, correlationId: string) {
  const db = await getDb();
  const a = await loadAssessment(ctx, assessmentId, "edit");
  if (body.profileRevision !== a.currentRevision) throw conflict("The profile changed since you opened the report builder. Reload and try again.");

  const scenarioRows = body.scenarioIds.length
    ? await db.select().from(schema.scenarios).where(and(eq(schema.scenarios.assessmentId, assessmentId), inArray(schema.scenarios.id, body.scenarioIds)))
    : [];
  if (scenarioRows.length !== body.scenarioIds.length) throw notFound("Scenario");
  for (const s of scenarioRows) {
    const stale = await scenarioStaleness(db, assessmentId, s.profileRevision);
    if (stale.length) throw invalid(`Scenario "${s.name}" is stale because ${stale.slice(0, 3).map(labelFor).join(", ")} changed. Recalculate it first.`);
  }
  const ordered = body.scenarioIds.map((id) => scenarioRows.find((s) => s.id === id)!);

  const view = await loadView(db, assessmentId);
  const evidence = await loadEvidence(db, assessmentId);
  const areaNames = [...new Set([...(view.get<string[]>("preferences.areas") ?? []), ...a.research.areas.map((x) => x.name)])].slice(0, 3);
  const fits = assessAreas(view, areaNames, evidence);
  const evidenceByArea: Record<string, number> = {};
  for (const e of evidence) evidenceByArea[e.area.toLowerCase()] = (evidenceByArea[e.area.toLowerCase()] ?? 0) + 1;
  const [org] = await db.select().from(schema.organisations).where(eq(schema.organisations.id, ctx.organisationId));
  const [agent] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, a.assignedAgentId));

  const snapshot = buildSnapshot({
    view,
    buyerDisplayName: a.buyerDisplayName,
    agentName: agent?.name ?? "",
    brandName: org.settings.brandName ?? org.name,
    profileRevision: a.currentRevision,
    readiness: readiness(view, { evidenceByArea }),
    scenarios: ordered.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      calculationVersion: s.calculationVersion,
      inputHash: s.inputHash,
      profileRevision: s.profileRevision,
      changes: s.changes as ScenarioChange[],
      assumptionLabels: s.assumptionLabels,
      result: s.result as ScenarioResult,
      purpose: (s.inputs as { purpose: string | null }).purpose,
    })),
    fits,
    evidence,
    includeAreas: body.includeAreas,
    attribution: org.settings.attribution ?? null,
    reportFooter: org.settings.reportFooter?.trim() || null,
  });

  const allowedTokens = [a.buyerDisplayName, ...ordered.map((s) => s.name), ...areaNames];
  const template = templateSections(snapshot);
  let narrative: Record<SectionKey, string> = template;
  let source: "ai" | "template" = "template";
  const cfg = aiConfig();
  if (cfg.enabled) {
    const started = Date.now();
    try {
      const ai = await draftReportWithAi(snapshot, allowedTokens);
      narrative = { ...template, ...ai.sections };
      source = "ai";
      await db.insert(schema.aiCalls).values({ organisationId: ctx.organisationId, assessmentId, mode: "report", model: ai.meta.model, promptVersion: PROMPT_VERSIONS.report, outcome: `ok:${ai.meta.attempts}`, latencyMs: Date.now() - started, inputTokens: ai.meta.inputTokens, outputTokens: ai.meta.outputTokens });
    } catch (err) {
      const code = err instanceof AiUnavailableError ? err.code : "provider_error";
      await db.insert(schema.aiCalls).values({ organisationId: ctx.organisationId, assessmentId, mode: "report", model: cfg.model, promptVersion: PROMPT_VERSIONS.report, outcome: `error:${code}`, latencyMs: Date.now() - started });
    }
  }
  // Every narrative must pass numeric-reference validation before it can be rendered (REP02).
  for (const key of SECTION_KEYS) {
    if (!validateNarrative(narrative[key], snapshot.values, allowedTokens).ok) narrative[key] = template[key];
    if (!validateNarrative(narrative[key], snapshot.values, allowedTokens).ok) throw new Error(`Template narrative failed validation for ${key}`);
  }

  const sections: ReportSections = {
    sections: SECTION_KEYS.map((key) => ({ key, title: SECTION_TITLES[key], narrative: narrative[key], commentary: "" })),
    nextActions: snapshot.nextActions.map((text) => ({ text, selected: true })),
  };

  const [prev] = await db.select().from(schema.reports).where(eq(schema.reports.assessmentId, assessmentId)).orderBy(desc(schema.reports.version)).limit(1);
  let changeSummary: string | null = null;
  if (prev) {
    const changed = await changedPathsSince(db, assessmentId, prev.profileRevision);
    const scenarioChange = JSON.stringify(prev.scenarioIds) !== JSON.stringify(body.scenarioIds);
    changeSummary = [
      changed.length ? `Profile changes since v${prev.version}: ${changed.slice(0, 8).map(labelFor).join(", ")}${changed.length > 8 ? "…" : ""}` : `No profile changes since v${prev.version}`,
      scenarioChange ? "Scenario selection changed" : null,
    ].filter(Boolean).join(". ");
  }

  const [row] = await db
    .insert(schema.reports)
    .values({
      organisationId: ctx.organisationId,
      assessmentId,
      version: (prev?.version ?? 0) + 1,
      profileRevision: a.currentRevision,
      scenarioIds: body.scenarioIds,
      evidenceIds: snapshot.evidence.map((e) => e.id),
      scope: { areaAssessment: snapshot.scope.areaAssessment, purchaseBudget: snapshot.scope.purchaseBudget },
      sections,
      snapshot,
      snapshotHash: reportHash(snapshot, sections),
      status: "draft",
      changeSummary,
      narrativeSource: source,
      createdById: ctx.userId,
    })
    .returning({ id: schema.reports.id, version: schema.reports.version });
  await audit(db, ctx, { action: "report.create", objectType: "report", objectId: row.id, assessmentId, correlationId, detail: { version: row.version, narrativeSource: source, scenarios: body.scenarioIds.length } });
  return row;
}

export async function loadReport(ctx: AuthContext, reportId: string, need: "view" | "edit" | "review" = "view") {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw notFound("Report");
  const db = await getDb();
  const [r] = await db.select().from(schema.reports).where(and(eq(schema.reports.id, reportId), eq(schema.reports.organisationId, ctx.organisationId)));
  if (!r) throw notFound("Report");
  const assessment = await loadAssessment(ctx, r.assessmentId, need);
  return { report: r, assessment, db };
}

export const UpdateReportBody = z.object({
  expectedRowVersion: z.number().int().positive(),
  commentary: z.record(z.enum(SECTION_KEYS), z.string().max(5000)).optional(),
  nextActions: z.array(z.object({ text: z.string().min(1).max(300), selected: z.boolean() })).max(30).optional(),
});

/** Agent commentary is editable on drafts. Calculated values can only change through recalculation. */
export async function updateReport(ctx: AuthContext, reportId: string, body: z.infer<typeof UpdateReportBody>, correlationId: string) {
  const { report, db } = await loadReport(ctx, reportId, "edit");
  if (report.status !== "draft" && report.status !== "needs_changes") throw invalid("Only draft reports can be edited. Create a new version to make changes.");
  const sections = structuredClone(report.sections as ReportSections);
  if (body.commentary) for (const s of sections.sections) if (body.commentary[s.key] !== undefined) s.commentary = body.commentary[s.key]!;
  if (body.nextActions) sections.nextActions = body.nextActions;
  const res = await db
    .update(schema.reports)
    .set({ sections, snapshotHash: reportHash(report.snapshot as ReportSnapshot, sections), rowVersion: report.rowVersion + 1 })
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.rowVersion, body.expectedRowVersion)))
    .returning({ rowVersion: schema.reports.rowVersion });
  if (!res.length) throw conflict("This report was changed by someone else. Reload to see the latest version.");
  await audit(db, ctx, { action: "report.edit", objectType: "report", objectId: reportId, assessmentId: report.assessmentId, correlationId, detail: { sections: Object.keys(body.commentary ?? {}) } });
  return res[0];
}

export const ReviewBody = z.object({
  expectedRowVersion: z.number().int().positive(),
  action: z.enum(["submit", "approve", "request_changes"]),
  comment: z.string().max(2000).optional(),
});

/** Section 13 state machine for reports. Reviewed reports are frozen; later changes create a new version. */
export async function reviewReport(ctx: AuthContext, reportId: string, body: z.infer<typeof ReviewBody>, correlationId: string) {
  const { report, db } = await loadReport(ctx, reportId, body.action === "submit" ? "edit" : "review");
  const transitions: Record<string, string[]> = { submit: ["draft", "needs_changes"], approve: ["ready_for_review"], request_changes: ["ready_for_review"] };
  if (!transitions[body.action].includes(report.status)) throw invalid(`Cannot ${body.action.replace("_", " ")} a report that is ${report.status.replaceAll("_", " ")}`);
  if (body.action === "request_changes" && !body.comment?.trim()) throw invalid("Add a comment explaining the changes needed", { comment: "Required" });

  if (body.action === "submit" || body.action === "approve") {
    // Stale inputs block submission/approval: the report must match current saved data.
    const stale = await changedPathsSince(db, report.assessmentId, report.profileRevision);
    if (stale.length) throw invalid(`The profile changed after this report was drafted (${stale.slice(0, 3).map(labelFor).join(", ")}). Create a new version.`);
  }

  const now = new Date();
  const next = body.action === "submit" ? "ready_for_review" : body.action === "approve" ? "reviewed" : "needs_changes";
  await db.transaction(async (tx: Parameters<Parameters<DB["transaction"]>[0]>[0]) => {
    const res = await tx
      .update(schema.reports)
      .set({
        status: next,
        rowVersion: report.rowVersion + 1,
        ...(body.action === "approve" ? { reviewerId: ctx.userId, reviewedAt: now, snapshotHash: reportHash(report.snapshot as ReportSnapshot, report.sections as ReportSections) } : {}),
        ...(body.comment ? { reviewComment: body.comment } : {}),
      })
      .where(and(eq(schema.reports.id, reportId), eq(schema.reports.rowVersion, body.expectedRowVersion)))
      .returning({ id: schema.reports.id });
    if (!res.length) throw conflict("This report was changed by someone else. Reload and try again.");
    if (body.action === "approve") {
      await tx
        .update(schema.reports)
        .set({ status: "superseded" })
        .where(and(eq(schema.reports.assessmentId, report.assessmentId), eq(schema.reports.status, "reviewed"), ne(schema.reports.id, reportId)));
    }
    await tx
      .update(schema.assessments)
      .set({ status: next === "reviewed" ? "reviewed" : next === "needs_changes" ? "needs_clarification" : "ready_for_review", updatedAt: now })
      .where(eq(schema.assessments.id, report.assessmentId));
    await audit(tx, ctx, { action: `report.${body.action}`, objectType: "report", objectId: reportId, assessmentId: report.assessmentId, correlationId, detail: { from: report.status, to: next } });
  });
  return { status: next };
}
