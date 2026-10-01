import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { loadAssessment } from "../access";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { getDb, schema } from "../db";
import {
  applyChanges,
  calculateScenario,
  CALCULATION_VERSION,
  compareResults,
  describeChange,
  explainDeltas,
  fundingCeiling,
  type ScenarioChange,
  type ScenarioInputs,
  type ScenarioResult,
} from "../finance";
import { conflict, invalid, notFound } from "../http";
import { buildFromProfile } from "../scenario/build";
import { loadView } from "./profile";

const cents = z.number().int().min(0).max(1e13);
export const ChangeSchema: z.ZodType<ScenarioChange> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_price"), cents, alsoValuation: z.boolean() }),
  z.object({ op: z.literal("set_valuation"), cents }),
  z.object({ op: z.literal("set_purchase_loan"), cents }),
  z.object({ op: z.literal("set_deposit"), cents }),
  z.object({ op: z.literal("set_equity_draw"), cents }),
  z.object({ op: z.literal("rate_add_pp"), pp: z.number().min(-20).max(20) }),
  z.object({ op: z.literal("rate_scale_relative_pct"), pct: z.number().min(-100).max(500) }),
  z.object({ op: z.literal("set_rate"), pct: z.number().min(0).max(100) }),
  z.object({ op: z.literal("set_repayment"), repayment: z.enum(["interest_only", "principal_and_interest"]) }),
  z.object({ op: z.literal("set_weekly_rent"), cents }),
  z.object({ op: z.literal("rent_scale_relative_pct"), pct: z.number().min(-100).max(500) }),
  z.object({ op: z.literal("set_vacant_weeks"), weeks: z.number().min(0).max(52) }),
  z.object({ op: z.literal("add_annual_cost"), label: z.string().min(1).max(80), cents }),
  z.object({ op: z.literal("valuation_scale_relative_pct"), pct: z.number().min(-100).max(500) }),
]);

export const CreateScenarioBody = z.object({
  idempotencyKey: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["base", "downside", "upside", "alternative"]),
  /** Named profile revision the scenario is calculated for. */
  profileRevision: z.number().int().nonnegative(),
  parentScenarioId: z.string().uuid().nullable().optional(),
  changes: z.array(ChangeSchema).max(20).default([]),
  purposeOverride: z.enum(["investment", "ppor"]).optional(),
});

const CHANGE_TARGETS: Record<ScenarioChange["op"], string[]> = {
  set_price: ["purchasePriceCents", "lenderValuationCents"],
  set_valuation: ["lenderValuationCents"],
  valuation_scale_relative_pct: ["lenderValuationCents"],
  set_purchase_loan: ["purchaseLoan.principalCents"],
  set_deposit: ["purchaseLoan.principalCents"],
  set_equity_draw: ["equityDraw.principalCents", "equityDraw.allocatedCents"],
  rate_add_pp: ["purchaseLoan.ratePct"],
  rate_scale_relative_pct: ["purchaseLoan.ratePct"],
  set_rate: ["purchaseLoan.ratePct"],
  set_repayment: ["purchaseLoan.repayment"],
  set_weekly_rent: ["rent.weeklyCents"],
  rent_scale_relative_pct: ["rent.weeklyCents"],
  set_vacant_weeks: ["rent.vacantWeeks"],
  add_annual_cost: [],
};

export function hashInputs(inputs: ScenarioInputs) {
  return createHash("sha256").update(CALCULATION_VERSION + JSON.stringify(inputs)).digest("hex");
}

export async function createScenario(ctx: AuthContext, assessmentId: string, body: z.infer<typeof CreateScenarioBody>, correlationId: string) {
  const db = await getDb();
  const a = await loadAssessment(ctx, assessmentId, "edit");
  if (body.profileRevision !== a.currentRevision)
    throw conflict("The profile has changed since this scenario was prepared. Reload and recalculate.");

  let inputs: ScenarioInputs;
  let labels: Record<string, string> = {};
  if (body.parentScenarioId) {
    const [parent] = await db
      .select()
      .from(schema.scenarios)
      .where(and(eq(schema.scenarios.id, body.parentScenarioId), eq(schema.scenarios.assessmentId, assessmentId)));
    if (!parent) throw notFound("Parent scenario");
    // The parent is never modified; changes produce a new immutable scenario.
    inputs = applyChanges(parent.inputs as ScenarioInputs, body.changes);
    labels = { ...(parent.assumptionLabels as Record<string, string>) };
  } else {
    const view = await loadView(db, assessmentId);
    const built = buildFromProfile(view, { purpose: body.purposeOverride });
    inputs = applyChanges(built.inputs, body.changes);
    labels = built.labels;
  }
  for (const ch of body.changes) {
    // The changed input is now an assumption, not the confirmed value it replaced.
    for (const k of CHANGE_TARGETS[ch.op]) delete labels[k];
    labels[`change:${ch.op}`] = `Assumption: ${describeChange(ch)}`;
  }

  const result = calculateScenario(inputs);
  const missing = [...result.funding.missing, ...result.cashflow.missing];
  const readinessText =
    result.funding.status === "complete" && (result.cashflow.status === "complete" || result.cashflow.status === "not_applicable")
      ? "complete"
      : result.funding.status === "invalid" || result.cashflow.status === "invalid"
        ? "invalid"
        : "incomplete";

  const [existing] = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.assessmentId, assessmentId), eq(schema.scenarios.inputHash, hashInputs(inputs)), eq(schema.scenarios.name, body.name)));
  if (existing) return { id: existing.id, duplicate: true };

  const [row] = await db
    .insert(schema.scenarios)
    .values({
      organisationId: ctx.organisationId,
      assessmentId,
      profileRevision: a.currentRevision,
      parentScenarioId: body.parentScenarioId ?? null,
      name: body.name,
      kind: body.kind,
      inputs,
      changes: body.changes,
      assumptionLabels: labels,
      calculationVersion: CALCULATION_VERSION,
      inputHash: hashInputs(inputs),
      result,
      readiness: readinessText,
      missingFields: missing,
      createdById: ctx.userId,
    })
    .returning({ id: schema.scenarios.id });
  await audit(db, ctx, { action: "scenario.create", objectType: "scenario", objectId: row.id, assessmentId, correlationId, detail: { kind: body.kind, changes: body.changes.map((c) => c.op), readiness: readinessText } });
  return { id: row.id, duplicate: false };
}

export async function archiveScenario(ctx: AuthContext, assessmentId: string, scenarioId: string, correlationId: string) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "edit");
  const res = await db
    .update(schema.scenarios)
    .set({ archived: true })
    .where(and(eq(schema.scenarios.id, scenarioId), eq(schema.scenarios.assessmentId, assessmentId)))
    .returning({ id: schema.scenarios.id });
  if (!res.length) throw notFound("Scenario");
  await audit(db, ctx, { action: "scenario.archive", objectType: "scenario", objectId: scenarioId, assessmentId, correlationId });
}

/** Compare up to three saved scenarios against the first; results are read, never mutated. */
export async function compareScenarios(ctx: AuthContext, assessmentId: string, ids: string[]) {
  if (ids.length < 2 || ids.length > 3) throw invalid("Choose two or three scenarios to compare");
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "view");
  const rows = await db.select().from(schema.scenarios).where(and(eq(schema.scenarios.assessmentId, assessmentId), inArray(schema.scenarios.id, ids)));
  if (rows.length !== ids.length) throw notFound("Scenario");
  const ordered = ids.map((id) => rows.find((r) => r.id === id)!);
  const base = ordered[0];
  return {
    base: { id: base.id, name: base.name },
    others: ordered.slice(1).map((o) => {
      const deltas = compareResults(base.result as ScenarioResult, o.result as ScenarioResult);
      return { id: o.id, name: o.name, changes: (o.changes as ScenarioChange[]).map(describeChange), deltas, explanation: explainDeltas(deltas) };
    }),
  };
}

export const CeilingBody = z.object({
  minPriceCents: cents,
  maxPriceCents: cents,
  stepCents: z.number().int().min(100).max(1e9),
  valuationPctOfPrice: z.number().min(1).max(200),
  purchaseLvrCapPct: z.number().min(1).max(100),
  costsPctOfPrice: z.number().min(0).max(20),
  fixedCostsCents: cents.nullable(),
  purposeOverride: z.enum(["investment", "ppor"]).optional(),
});

export async function calculateCeiling(ctx: AuthContext, assessmentId: string, body: z.infer<typeof CeilingBody>) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "view");
  const view = await loadView(db, assessmentId);
  const { inputs } = buildFromProfile(view, { purpose: body.purposeOverride });
  const fixed = body.fixedCostsCents ?? view.get<number>("scenario.purchaseCosts") ?? null;
  return fundingCeiling(inputs, { ...body, fixedCostsCents: fixed });
}
