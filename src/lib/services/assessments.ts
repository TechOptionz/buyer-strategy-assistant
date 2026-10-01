import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canEdit, canReview, loadAssessment, has } from "../access";
import { aiConfig } from "../ai/config";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { type DB, getDb, schema } from "../db";
import { date as formatDate } from "../format";
import { conflict, forbidden, invalid, notFound } from "../http";
import { defaultOutputs, eligibleQuestions, nextStep, readiness, readinessHeadline, topicProgress, type NextStep } from "../interview/engine";
import { expandQuestions, type ExpandedQuestion } from "../interview/registry";
import { assessAreas, detectGoalConflicts, type EvidenceItem } from "../market/fit";
import { getProvider } from "../market/provider";
import { fieldDef, formatValue, labelFor } from "../profile/fields";
import type { ProfileView } from "../profile/state";
import { addAssistantTurn, nextSequence } from "./extraction";
import { enqueue } from "./jobs";
import { loadView, setConfirmedFields, type FieldEntry } from "./profile";

export const CreateAssessmentBody = z.object({
  buyerDisplayName: z.string().trim().min(1).max(120),
  entryMode: z.enum(["notes", "guided"]),
  assignedAgentId: z.string().uuid().optional(),
  reviewerId: z.string().uuid().nullable().optional(),
});

export async function createAssessment(ctx: AuthContext, body: z.infer<typeof CreateAssessmentBody>, idempotencyKey: string, correlationId: string) {
  const db = await getDb();
  const agentId = body.assignedAgentId ?? ctx.userId;
  if (agentId !== ctx.userId && ctx.role !== "org_admin") throw invalid("Only administrators can assign cases to other agents");
  for (const uid of [agentId, body.reviewerId].filter(Boolean) as string[]) {
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.organisationId, ctx.organisationId), eq(schema.memberships.userId, uid)));
    if (!m) throw invalid("Assigned user is not in your organisation");
  }
  const inserted = await db
    .insert(schema.assessments)
    .values({
      organisationId: ctx.organisationId,
      buyerDisplayName: body.buyerDisplayName,
      entryMode: body.entryMode,
      assignedAgentId: agentId,
      reviewerId: body.reviewerId ?? null,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    const [existing] = await db
      .select()
      .from(schema.assessments)
      .where(and(eq(schema.assessments.organisationId, ctx.organisationId), eq(schema.assessments.idempotencyKey, idempotencyKey)));
    return { assessment: existing, created: false };
  }
  const a = inserted[0];
  await audit(db, ctx, { action: "assessment.create", objectType: "assessment", objectId: a.id, assessmentId: a.id, correlationId });
  return { assessment: a, created: true };
}

/** Case-list status: the case lifecycle, refined by the latest report's review state. */
export type CaseListStatus = "draft" | "needs_clarification" | "ready_for_review" | "needs_changes" | "reviewed";
export const CASE_LIST_STATUSES: CaseListStatus[] = ["draft", "needs_clarification", "ready_for_review", "needs_changes", "reviewed"];

function displayStatus(caseStatus: string, reportStatus: string | null, conflicts: number): CaseListStatus {
  if (conflicts > 0) return "needs_clarification";
  // A reviewer's "request changes" also moves the case to needs_clarification; show the specific reason.
  if (reportStatus === "needs_changes") return "needs_changes";
  if (caseStatus === "needs_clarification") return "needs_clarification";
  if (reportStatus === "ready_for_review" || caseStatus === "ready_for_review") return "ready_for_review";
  if (reportStatus === "reviewed" || caseStatus === "reviewed") return "reviewed";
  return "draft";
}

function visibleTo(ctx: AuthContext) {
  return has(ctx, "case_access_all") ? sql`true` : or(eq(schema.assessments.assignedAgentId, ctx.userId), eq(schema.assessments.reviewerId, ctx.userId));
}

export type CaseView = "all" | "mine" | "review";

/**
 * Case list with the typed columns the dashboard needs (status, target price, finance, next step).
 * Status filtering happens after derivation because the displayed status depends on the report.
 */
export async function listAssessments(ctx: AuthContext, opts: { q?: string; page: number; pageSize: number; status?: CaseListStatus; view?: CaseView }) {
  const db = await getDb();
  const where = and(
    eq(schema.assessments.organisationId, ctx.organisationId),
    visibleTo(ctx),
    opts.view === "mine" ? eq(schema.assessments.assignedAgentId, ctx.userId) : undefined,
    opts.q ? ilike(schema.assessments.buyerDisplayName, `%${opts.q}%`) : undefined,
  );
  const rows = await db
    .select({
      id: schema.assessments.id,
      buyerDisplayName: schema.assessments.buyerDisplayName,
      status: schema.assessments.status,
      entryMode: schema.assessments.entryMode,
      updatedAt: schema.assessments.updatedAt,
      isSeed: schema.assessments.isSeed,
      agentName: schema.users.name,
      assignedAgentId: schema.assessments.assignedAgentId,
      research: schema.assessments.research,
    })
    .from(schema.assessments)
    .innerJoin(schema.users, eq(schema.users.id, schema.assessments.assignedAgentId))
    .where(where)
    .orderBy(desc(schema.assessments.updatedAt))
    .limit(500);

  const all = [];
  for (const r of rows) {
    const view = await loadView(db, r.id);
    const [rep] = await db
      .select({ status: schema.reports.status, version: schema.reports.version, createdAt: schema.reports.createdAt, reviewedAt: schema.reports.reviewedAt, reviewComment: schema.reports.reviewComment })
      .from(schema.reports)
      .where(eq(schema.reports.assessmentId, r.id))
      .orderBy(desc(schema.reports.version))
      .limit(1);
    const conflicts = Object.keys(view.state.conflicts);
    const proposed = view.state.proposed.length;
    const ready = readiness(view, { evidenceByArea: {} }).filter((x) => x.output !== "area_fit");
    const status = displayStatus(r.status, rep?.status ?? null, conflicts.length);
    const progress = topicProgress(view);
    const remaining = progress.reduce((n, p) => n + Math.max(0, p.total - p.answered), 0);
    const nextTopic = progress.find((p) => p.answered < p.total);
    const finance = view.get<string>("finance.confirmationStatus");
    const limitScope = view.get<string>("finance.limitScope");

    let nextStep: { text: string; attention: boolean };
    if (conflicts.length) nextStep = { text: `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}: ${conflicts.map((p) => labelFor(p).toLowerCase()).join(", ")}`, attention: true };
    else if (rep?.status === "needs_changes") nextStep = { text: `Reviewer: ${rep.reviewComment ?? "changes requested"}`, attention: true };
    else if (rep?.status === "ready_for_review") nextStep = { text: `Report v${rep.version} awaiting review`, attention: false };
    else if (rep?.status === "reviewed") nextStep = { text: `Reviewed${rep.reviewedAt ? ` ${formatDate(rep.reviewedAt)}` : ""}`, attention: false };
    else if (proposed) nextStep = { text: `${r.entryMode === "notes" ? "Pasted notes · " : ""}${proposed} fact${proposed > 1 ? "s" : ""} to confirm`, attention: false };
    else if (limitScope === "not_sure") nextStep = { text: "Borrowing limit scope unresolved", attention: true };
    else if (!view.known("goals.purchasePurpose")) nextStep = { text: "Purchase purpose not yet asked", attention: false };
    else if (remaining > 0) nextStep = { text: `${remaining} question${remaining > 1 ? "s" : ""} left${nextTopic ? ` · ${nextTopic.label}` : ""}`, attention: false };
    else if (ready.some((x) => x.status !== "ready")) nextStep = { text: `${ready.filter((x) => x.status !== "ready").length} output${ready.filter((x) => x.status !== "ready").length > 1 ? "s" : ""} incomplete`, attention: false };
    else nextStep = { text: "Ready to draft report", attention: false };

    const [scn] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.scenarios).where(and(eq(schema.scenarios.assessmentId, r.id), eq(schema.scenarios.archived, false)));
    const pastInterview = !!rep || (scn?.n ?? 0) > 0 || remaining === 0;
    const areas = view.get<string[]>("preferences.areas") ?? r.research.areas.map((a) => a.name);
    all.push({
      ...r,
      research: undefined,
      displayStatus: status,
      /** Badge to show: a draft case past the interview reads "Assessment in progress". */
      badgeStatus: status === "draft" && pastInterview ? "assessing" : status,
      purpose: view.get<string>("goals.purchasePurpose"),
      areas,
      targetPriceCents: view.get<number>("scenario.targetPrice") ?? view.get<number>("preferences.budgetMax") ?? null,
      finance: finance === "pre_approval" || finance === "formal_approval" ? "confirmed" : view.known("finance.borrowingLimit") ? "not_confirmed" : "not_provided",
      conflicts: conflicts.length,
      proposed,
      nextStep,
      headline: readinessHeadline(ready),
      reportStatus: rep?.status ?? null,
      updatedAt: r.updatedAt.toISOString(),
    });
  }

  const reviewable = all.filter((c) => c.displayStatus === "ready_for_review");
  const scoped = opts.view === "review" ? reviewable : all;
  const counts: Record<CaseListStatus | "all", number> = { all: scoped.length, draft: 0, needs_clarification: 0, ready_for_review: 0, needs_changes: 0, reviewed: 0 };
  for (const c of scoped) counts[c.displayStatus]++;
  const filtered = opts.status ? scoped.filter((c) => c.displayStatus === opts.status) : scoped;
  const start = (opts.page - 1) * opts.pageSize;
  return { items: filtered.slice(start, start + opts.pageSize), total: filtered.length, counts, hasMore: start + opts.pageSize < filtered.length };
}

/** Sidebar counts and pinned-case statuses. */
export async function navSummary(ctx: AuthContext) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.assessments.id, name: schema.assessments.buyerDisplayName, status: schema.assessments.status })
    .from(schema.assessments)
    .where(and(eq(schema.assessments.organisationId, ctx.organisationId), visibleTo(ctx)));
  const ids = rows.map((r) => r.id);
  let review = 0;
  if (ids.length) {
    const reps = await db
      .select({ assessmentId: schema.reports.assessmentId, status: schema.reports.status, version: schema.reports.version })
      .from(schema.reports)
      .where(inArray(schema.reports.assessmentId, ids));
    const latest = new Map<string, { status: string; version: number }>();
    for (const r of reps) if ((latest.get(r.assessmentId)?.version ?? 0) < r.version) latest.set(r.assessmentId, r);
    review = [...latest.values()].filter((r) => r.status === "ready_for_review").length;
  }
  return { cases: rows.length, review, all: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })) };
}

/** CON08 + ANA07 status sync after profile changes (Section 13). */
export async function syncStatus(db: DB, assessmentId: string) {
  const view = await loadView(db, assessmentId);
  const [a] = await db.select().from(schema.assessments).where(eq(schema.assessments.id, assessmentId));
  const hasConflicts = Object.keys(view.state.conflicts).length > 0;
  let status = a.status;
  if (hasConflicts) status = "needs_clarification";
  else if (a.status === "needs_clarification" || a.status === "reviewed") status = "draft";
  if (status !== a.status) await db.update(schema.assessments).set({ status }).where(eq(schema.assessments.id, assessmentId));
}

// ─────────────────────────────── Turns (guided interview) ───────────────────────────────

export const TurnBody = z.object({
  idempotencyKey: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
  action: z.enum(["answer", "not_sure", "skip", "free_text", "notes", "decline"]),
  questionKey: z.string().max(80).optional(),
  answer: z.object({ value: z.unknown(), frequency: z.string().optional() }).optional(),
  text: z.string().max(50_000).optional(),
});

function findQuestion(view: ProfileView, instanceKey: string): ExpandedQuestion {
  const q = expandQuestions(view.propertyIndexes().length ? view.propertyIndexes() : [1]).find((x) => x.instanceKey === instanceKey);
  if (!q) throw invalid("Unknown question");
  return q;
}

function answerEntries(q: ExpandedQuestion, answer: { value: unknown; frequency?: string }): { entries: FieldEntry[]; display: string } {
  const [target] = q.targets;
  if (q.answerType === "money_period") {
    if (!answer.frequency) throw invalid("Choose how often", { frequency: "Required" });
    const entries: FieldEntry[] = [
      { path: q.targets[0], valueState: "value", value: answer.value },
      { path: q.targets[1], valueState: "value", value: answer.frequency },
    ];
    return { entries, display: `${formatValue(q.targets[0], answer.value)} ${q.options?.find((o) => o.value === answer.frequency)?.label ?? answer.frequency}` };
  }
  let value = answer.value;
  if (q.answerType === "boolean") value = answer.value === true || answer.value === "true";
  return { entries: [{ path: target, valueState: "value", value }], display: formatValue(target, value) };
}

export async function submitTurn(ctx: AuthContext, assessmentId: string, body: z.infer<typeof TurnBody>, correlationId: string) {
  const db = await getDb();
  const a = await loadAssessment(ctx, assessmentId, "edit");
  // Idempotency: a repeated request returns without creating a second turn (AT04).
  const [dup] = await db
    .select()
    .from(schema.turns)
    .where(and(eq(schema.turns.assessmentId, assessmentId), eq(schema.turns.idempotencyKey, body.idempotencyKey)));
  if (dup) return { duplicate: true, jobId: null as string | null, revision: a.currentRevision };
  if (body.expectedRevision !== a.currentRevision && (body.action === "answer" || body.action === "not_sure" || body.action === "decline"))
    throw conflict("The profile changed since this question was shown. Reload to continue.");

  const view = await loadView(db, assessmentId);
  const q = body.questionKey ? findQuestion(view, body.questionKey) : null;
  const saveTurn = async (author: "agent" | "buyer", kind: "answer" | "notes" | "message", text: string) => {
    const [t] = await db
      .insert(schema.turns)
      .values({ organisationId: ctx.organisationId, assessmentId, sequence: await nextSequence(db, assessmentId), author, kind, text, questionKey: body.questionKey ?? null, idempotencyKey: body.idempotencyKey, extractionStatus: kind === "answer" ? "none" : "pending" })
      .onConflictDoNothing()
      .returning();
    return t;
  };
  if (q) await addAssistantTurn(db, ctx.organisationId, assessmentId, q.prompt, `ask:${body.idempotencyKey}`, q.instanceKey);

  switch (body.action) {
    case "answer": {
      if (!q || !body.answer) throw invalid("Answer and question are required");
      const { entries, display } = answerEntries(q, body.answer);
      const turn = await saveTurn("agent", "answer", display);
      const revision = await setConfirmedFields(db, ctx, assessmentId, body.expectedRevision, entries, { type: "conversation", id: turn?.id, evidence: `${q.prompt} — ${display}` }, correlationId);
      await syncStatus(db, assessmentId);
      return { duplicate: false, jobId: null, revision };
    }
    case "not_sure":
    case "decline": {
      if (!q) throw invalid("Question is required");
      const turn = await saveTurn("agent", "answer", body.action === "not_sure" ? "Not sure" : "Prefer not to say");
      const entries: FieldEntry[] = q.targets.map((path) => {
        const def = fieldDef(path);
        // An enum with an explicit "not_sure" option records it, so the gap stays visible as unresolved.
        if (body.action === "not_sure" && def?.options?.some((o) => o.value === "not_sure")) return { path, valueState: "value", value: "not_sure" };
        return { path, valueState: body.action === "not_sure" ? "unknown" : "declined" };
      });
      const revision = await setConfirmedFields(db, ctx, assessmentId, body.expectedRevision, entries, { type: "conversation", id: turn?.id, evidence: `${q.prompt} — ${turn?.text}` }, correlationId);
      await syncStatus(db, assessmentId);
      return { duplicate: false, jobId: null, revision };
    }
    case "skip": {
      if (!q) throw invalid("Question is required");
      await saveTurn("agent", "answer", "[Skipped]");
      return { duplicate: false, jobId: null, revision: a.currentRevision };
    }
    case "free_text":
    case "notes": {
      const text = (body.text ?? "").trim();
      if (!text) throw invalid("Enter some text", { text: "Required" });
      const turn = await saveTurn(body.action === "notes" ? "agent" : "buyer", body.action === "notes" ? "notes" : "message", text);
      const { job } = await enqueue(db, ctx, "extract_notes", body.idempotencyKey, { text, turnId: turn.id, sourceType: body.action === "notes" ? "notes" : "conversation" }, assessmentId);
      await audit(db, ctx, { action: body.action === "notes" ? "notes.submit" : "turn.free_text", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { chars: text.length } });
      return { duplicate: false, jobId: job.id, revision: a.currentRevision };
    }
  }
}

// ─────────────────────────────── Workspace view model ───────────────────────────────

const PURCHASE_TOPICS = /^(finance|funds|funding|scenario|properties|portfolio|household|super|goals\.purchasePurpose)/;

export async function changedPathsSince(db: DB, assessmentId: string, revision: number) {
  const rows = await db
    .select({ changedPaths: schema.profileRevisions.changedPaths })
    .from(schema.profileRevisions)
    .where(and(eq(schema.profileRevisions.assessmentId, assessmentId), gt(schema.profileRevisions.revision, revision)));
  return [...new Set(rows.flatMap((r) => r.changedPaths))];
}

/** ANA07: financing changes invalidate purchase scenarios; geography changes invalidate comparisons. */
export async function scenarioStaleness(db: DB, assessmentId: string, profileRevision: number) {
  const changed = await changedPathsSince(db, assessmentId, profileRevision);
  return changed.filter((p) => PURCHASE_TOPICS.test(p));
}

export async function loadEvidence(db: DB, assessmentId: string): Promise<(EvidenceItem & { retrievedAt: Date; providerRecordRef: string | null })[]> {
  const rows = await db.select().from(schema.marketEvidence).where(eq(schema.marketEvidence.assessmentId, assessmentId)).orderBy(desc(schema.marketEvidence.periodEnd));
  return rows.map((r) => ({ ...r }));
}

function serialiseStep(step: NextStep) {
  if (step.kind !== "question") return step;
  const q = step.question;
  return {
    kind: "question" as const,
    stage: step.stage,
    question: { key: q.instanceKey, topic: q.topic, prompt: q.prompt, reason: q.reason ?? null, answerType: q.answerType, options: q.options ?? null, targets: q.targets, optional: q.optional, requiredFor: q.requiredFor },
  };
}

export async function getWorkspace(ctx: AuthContext, assessmentId: string) {
  const db = await getDb();
  const a = await loadAssessment(ctx, assessmentId, "view");
  const view = await loadView(db, assessmentId);
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.assessmentId, assessmentId)).orderBy(asc(schema.turns.sequence));
  const evidence = await loadEvidence(db, assessmentId);

  const areas = view.get<string[]>("preferences.areas") ?? [];
  const researchAreas = [...new Set([...areas, ...a.research.areas.map((x) => x.name)])].slice(0, 6);
  const fits = assessAreas(view, researchAreas, evidence);
  const goalConflicts = detectGoalConflicts(view, fits);

  const answeredKeys = new Set(turns.filter((t) => t.kind === "answer" && t.text !== "[Skipped]").map((t) => t.questionKey));
  const skipped = new Set(turns.filter((t) => t.kind === "answer" && t.text === "[Skipped]" && !answeredKeys.has(t.questionKey)).map((t) => t.questionKey!));
  const evidenceByArea: Record<string, number> = {};
  for (const e of evidence) evidenceByArea[e.area.toLowerCase()] = (evidenceByArea[e.area.toLowerCase()] ?? 0) + 1;

  const ready = readiness(view, { evidenceByArea });
  const step = nextStep(view, { skipped, requestedOutputs: defaultOutputs(view), goalConflicts });

  // Skipped required questions: explain which output remains incomplete (CON05).
  const skippedRequired = eligibleQuestions(view)
    .filter((q) => skipped.has(q.instanceKey) && !q.optional && q.targets.some((t) => !view.answered(t)))
    .map((q) => ({ key: q.instanceKey, prompt: q.prompt, affects: q.requiredFor }));

  const scenarioRows = await db
    .select()
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.assessmentId, assessmentId), eq(schema.scenarios.archived, false)))
    .orderBy(asc(schema.scenarios.createdAt));
  const scenarios = [];
  for (const s of scenarioRows) scenarios.push({ ...s, staleBecause: await scenarioStaleness(db, assessmentId, s.profileRevision) });

  const reportRows = await db
    .select({ id: schema.reports.id, version: schema.reports.version, status: schema.reports.status, createdAt: schema.reports.createdAt, reviewedAt: schema.reports.reviewedAt, profileRevision: schema.reports.profileRevision, changeSummary: schema.reports.changeSummary, reviewComment: schema.reports.reviewComment })
    .from(schema.reports)
    .where(eq(schema.reports.assessmentId, assessmentId))
    .orderBy(desc(schema.reports.version));

  const agent = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, a.assignedAgentId));
  const people = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organisationId, ctx.organisationId));
  const pending = await db
    .select({ id: schema.jobs.id, status: schema.jobs.status, type: schema.jobs.type })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.assessmentId, assessmentId), inArray(schema.jobs.status, ["queued", "running"])));

  const historyRows = await db
    .select({ id: schema.facts.id, fieldPath: schema.facts.fieldPath, valueState: schema.facts.valueState, value: schema.facts.value, status: schema.facts.status, sourceType: schema.facts.sourceType, evidenceText: schema.facts.evidenceText, confirmedById: schema.facts.confirmedById, confirmedAt: schema.facts.confirmedAt, createdAt: schema.facts.createdAt })
    .from(schema.facts)
    .where(and(eq(schema.facts.assessmentId, assessmentId), inArray(schema.facts.status, ["superseded", "rejected"])))
    .orderBy(desc(schema.facts.createdAt))
    .limit(300);
  const history: Record<string, typeof historyRows> = {};
  for (const h of historyRows) (history[h.fieldPath] ??= []).push(h);

  // Activity: audit events never contain buyer financial values (field paths and counts only).
  const activityRows = await db
    .select({ id: schema.auditEvents.id, action: schema.auditEvents.action, objectType: schema.auditEvents.objectType, actorId: schema.auditEvents.actorId, detail: schema.auditEvents.detail, createdAt: schema.auditEvents.createdAt })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.organisationId, ctx.organisationId), eq(schema.auditEvents.assessmentId, assessmentId)))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(200);

  // Area names used anywhere in the organisation (preferences, research, evidence) — suggestions for
  // the searchable location control. Names only; nothing buyer-financial.
  const areaFacts = await db
    .select({ value: schema.facts.value })
    .from(schema.facts)
    .where(and(eq(schema.facts.organisationId, ctx.organisationId), inArray(schema.facts.fieldPath, ["preferences.areas", "preferences.excludedAreas"]), inArray(schema.facts.status, ["confirmed", "proposed"])))
    .limit(2000);
  const evidenceAreas = await db.selectDistinct({ area: schema.marketEvidence.area }).from(schema.marketEvidence).where(eq(schema.marketEvidence.organisationId, ctx.organisationId)).limit(2000);
  const researchRows = await db.select({ research: schema.assessments.research }).from(schema.assessments).where(eq(schema.assessments.organisationId, ctx.organisationId)).limit(2000);
  const knownAreas = new Map<string, string>();
  const addArea = (name: unknown) => {
    if (typeof name !== "string") return;
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length >= 2 && clean.length <= 80 && !knownAreas.has(clean.toLowerCase())) knownAreas.set(clean.toLowerCase(), clean);
  };
  for (const f of areaFacts) if (Array.isArray(f.value)) f.value.forEach(addArea);
  for (const e of evidenceAreas) addArea(e.area);
  for (const r of researchRows) r.research.areas.forEach((x) => addArea(x.name));

  const provider = getProvider();
  return {
    knownAreas: [...knownAreas.values()].sort((a, b) => a.localeCompare(b)),
    activity: activityRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    history,
    assessment: {
      id: a.id,
      buyerDisplayName: a.buyerDisplayName,
      status: a.status,
      entryMode: a.entryMode,
      currentRevision: a.currentRevision,
      updatedAt: a.updatedAt.toISOString(),
      isSeed: a.isSeed,
      agentName: agent[0]?.name ?? "",
      reviewerId: a.reviewerId,
      createdAt: a.createdAt.toISOString(),
      research: a.research,
    },
    permissions: { canEdit: canEdit(ctx, a), canReview: canReview(ctx, a) },
    profile: {
      confirmed: view.state.confirmed,
      conflicts: view.state.conflicts,
      proposed: view.state.proposed.map((f) => ({ ...f, label: labelFor(f.fieldPath), conflictsWithConfirmed: !!view.state.confirmed[f.fieldPath] && JSON.stringify(view.state.confirmed[f.fieldPath].value) !== JSON.stringify(f.value) })),
      propertyIndexes: view.propertyIndexes(),
    },
    people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    readiness: ready,
    headline: readinessHeadline(ready),
    progress: topicProgress(view),
    next: serialiseStep(step),
    skippedRequired,
    turns: turns.map((t) => ({ id: t.id, author: t.author, kind: t.kind, text: t.text, questionKey: t.questionKey, extractionStatus: t.extractionStatus, createdAt: t.createdAt.toISOString() })),
    evidence: evidence.map((e) => ({ ...e, retrievedAt: e.retrievedAt.toISOString() })),
    fits,
    goalConflicts,
    scenarios: scenarios.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    reports: reportRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), reviewedAt: r.reviewedAt?.toISOString() ?? null })),
    pendingJobs: pending,
    reviewers: await reviewerCandidates(ctx),
    ai: { enabled: aiConfig().enabled, model: aiConfig().enabled ? aiConfig().model : null },
    provider: { id: provider.id, label: provider.label },
  };
}

export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;

export async function setResearchAreas(ctx: AuthContext, assessmentId: string, areas: string[], correlationId: string) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "edit");
  const clean = [...new Set(areas.map((x) => x.trim()).filter(Boolean))].slice(0, 3);
  await db
    .update(schema.assessments)
    .set({ research: { areas: clean.map((name) => ({ name, addedAt: new Date().toISOString() })) }, updatedAt: new Date() })
    .where(eq(schema.assessments.id, assessmentId));
  await audit(db, ctx, { action: "research.areas", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { count: clean.length } });
}

/** Organisation members who can review reports: the reviewer role, administrators, or the review permission. */
export async function reviewerCandidates(ctx: AuthContext) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role, permissions: schema.memberships.permissions })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organisationId, ctx.organisationId))
    .orderBy(asc(schema.users.name));
  return rows.filter((r) => r.role === "reviewer" || r.role === "org_admin" || (r.permissions ?? []).includes("review")).map((r) => ({ id: r.id, name: r.name, role: r.role }));
}

export const SetReviewerBody = z.object({ reviewerId: z.string().uuid().nullable() });

/**
 * Assign (or clear) the case reviewer. The assigned agent or an administrator may do this; the
 * reviewer must be an organisation member able to review. Assignment is what gives a reviewer
 * visibility of the case (see access.canView).
 */
export async function setReviewer(ctx: AuthContext, assessmentId: string, reviewerId: string | null, correlationId: string) {
  const db = await getDb();
  const a = await loadAssessment(ctx, assessmentId, "view");
  if (a.assignedAgentId !== ctx.userId && ctx.role !== "org_admin") throw forbidden();
  if (reviewerId) {
    const ok = (await reviewerCandidates(ctx)).some((c) => c.id === reviewerId);
    if (!ok) throw invalid("Choose a reviewer from your organisation", { reviewerId: "Not a reviewer in this organisation" });
  }
  await db.update(schema.assessments).set({ reviewerId, updatedAt: new Date() }).where(eq(schema.assessments.id, assessmentId));
  await audit(db, ctx, { action: "assessment.assign_reviewer", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { assigned: !!reviewerId } });
}

export async function assertExists<T>(v: T | undefined | null, what: string): Promise<T> {
  if (!v) throw notFound(what);
  return v;
}
