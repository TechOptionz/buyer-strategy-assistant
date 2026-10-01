import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { loadAssessment } from "../access";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { getDb, schema } from "../db";
import { invalid, notFound } from "../http";
import { metricDef, METRICS } from "../market/metrics";
import { getProvider } from "../market/provider";

export const ManualEvidenceBody = z.object({
  area: z.string().trim().min(2).max(80),
  propertyType: z.enum(["house", "unit", "townhouse", "all"]),
  metric: z.enum(METRICS.map((m) => m.key) as [string, ...string[]]),
  value: z.number().finite(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourceDescription: z.string().trim().min(3).max(300),
  /** Date the figure was published/observed (drives freshness). */
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Manual evidence requires a value, unit, source description and date (Section 8). */
export async function addManualEvidence(ctx: AuthContext, assessmentId: string, body: z.infer<typeof ManualEvidenceBody>, correlationId: string) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "edit");
  const def = metricDef(body.metric)!;
  if (new Date(body.observedAt) > new Date(Date.now() + 86_400_000)) throw invalid("Observation date cannot be in the future", { observedAt: "Future date" });
  if (body.periodStart && body.periodStart > body.periodEnd) throw invalid("Period start must be before period end", { periodStart: "After end" });
  if (def.unit === "%" && (body.value < -100 || body.value > 100)) throw invalid("Percentage out of range", { value: "Out of range" });
  if (def.unit !== "%" && body.value < 0) throw invalid("Value cannot be negative", { value: "Negative" });
  const [row] = await db
    .insert(schema.marketEvidence)
    .values({
      organisationId: ctx.organisationId,
      assessmentId,
      provider: "manual",
      area: body.area,
      propertyType: body.propertyType,
      metric: body.metric,
      valueNumeric: String(body.value),
      unit: def.unit,
      periodStart: body.periodStart ?? null,
      periodEnd: body.periodEnd,
      sourceDescription: body.sourceDescription,
      observedAt: body.observedAt,
      enteredById: ctx.userId,
      quality: { entry: "manual" },
    })
    .returning({ id: schema.marketEvidence.id });
  await audit(db, ctx, { action: "evidence.add", objectType: "market_evidence", objectId: row.id, assessmentId, correlationId, detail: { metric: body.metric, provider: "manual" } });
  return row;
}

export async function deleteEvidence(ctx: AuthContext, assessmentId: string, evidenceId: string, correlationId: string) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "edit");
  // Evidence cited by any report is kept for reproducibility.
  const reports = await db.select({ ids: schema.reports.evidenceIds }).from(schema.reports).where(eq(schema.reports.assessmentId, assessmentId));
  if (reports.some((r) => r.ids.includes(evidenceId))) throw invalid("This evidence is cited by a saved report and cannot be removed.");
  const res = await db
    .delete(schema.marketEvidence)
    .where(and(eq(schema.marketEvidence.id, evidenceId), eq(schema.marketEvidence.assessmentId, assessmentId)))
    .returning({ id: schema.marketEvidence.id });
  if (!res.length) throw notFound("Evidence");
  await audit(db, ctx, { action: "evidence.delete", objectType: "market_evidence", objectId: evidenceId, assessmentId, correlationId });
}

export const LookupBody = z.object({ area: z.string().trim().min(2).max(80), propertyType: z.enum(["house", "unit", "townhouse", "all"]) });

/**
 * Provider lookup. Returns structured per-request results; when no provider is licensed and
 * configured, the result says so — the system never claims a search was performed or invents data.
 */
export async function providerLookup(ctx: AuthContext, assessmentId: string, body: z.infer<typeof LookupBody>, correlationId: string) {
  const db = await getDb();
  await loadAssessment(ctx, assessmentId, "edit");
  const provider = getProvider();
  const resolved = await provider.resolveArea(body.area);
  await audit(db, ctx, { action: "evidence.lookup", objectType: "assessment", objectId: assessmentId, assessmentId, correlationId, detail: { provider: provider.id, status: resolved.status } });
  if (resolved.status !== "ok") return { provider: provider.id, status: resolved.status, message: resolved.message, saved: 0 };
  const area = resolved.data[0];
  if (!area) return { provider: provider.id, status: "unavailable", message: "Area not found by provider", saved: 0 };
  const stats = await provider.getAreaStatistics(area.areaId, body.propertyType, { to: new Date().toISOString().slice(0, 10) });
  if (stats.status !== "ok") return { provider: provider.id, status: stats.status, message: stats.message, saved: 0 };
  for (const m of stats.data) {
    await db.insert(schema.marketEvidence).values({
      organisationId: ctx.organisationId,
      assessmentId,
      provider: provider.id,
      providerRecordRef: m.providerRecordRef,
      area: body.area,
      propertyType: m.propertyType,
      metric: m.metric,
      valueNumeric: String(m.value),
      unit: m.unit,
      periodStart: m.periodStart ?? null,
      periodEnd: m.periodEnd,
      sourceDescription: `${provider.label}${m.methodology ? ` — ${m.methodology}` : ""}`,
      observedAt: m.periodEnd,
      retrievedAt: new Date(stats.retrievedAt),
      quality: m.quality ?? null,
    });
  }
  return { provider: provider.id, status: "ok", message: `${stats.data.length} metrics saved`, saved: stats.data.length };
}
