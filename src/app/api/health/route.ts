import { and, eq, gt, sql } from "drizzle-orm";
import { aiConfig } from "@/lib/ai/config";
import { getAuth } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { getProvider } from "@/lib/market/provider";

/**
 * GET /api/health — liveness for anyone; operational metrics (no buyer financial values) for admins:
 * job failures, provider availability, AI latency and AI cost inputs per assessment.
 */
export async function GET() {
  let dbOk = false;
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const base = { status: dbOk ? "ok" : "degraded", database: dbOk ? "ok" : "unavailable", time: new Date().toISOString() };
  const auth = dbOk ? await getAuth().catch(() => null) : null;
  if (!auth || (auth.role !== "org_admin" && !auth.permissions.includes("manage_org"))) return Response.json(base, { status: dbOk ? 200 : 503 });

  const db = await getDb();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const jobs = await db
    .select({ type: schema.jobs.type, status: schema.jobs.status, n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.organisationId, auth.organisationId), gt(schema.jobs.createdAt, since)))
    .groupBy(schema.jobs.type, schema.jobs.status);
  const ai = await db
    .select({
      mode: schema.aiCalls.mode,
      calls: sql<number>`count(*)::int`,
      failures: sql<number>`sum(case when ${schema.aiCalls.outcome} like 'error:%' then 1 else 0 end)::int`,
      avgLatencyMs: sql<number>`coalesce(avg(${schema.aiCalls.latencyMs}),0)::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)::int`,
      assessments: sql<number>`count(distinct ${schema.aiCalls.assessmentId})::int`,
    })
    .from(schema.aiCalls)
    .where(and(eq(schema.aiCalls.organisationId, auth.organisationId), gt(schema.aiCalls.createdAt, since)))
    .groupBy(schema.aiCalls.mode);
  const cfg = aiConfig();
  const provider = getProvider();
  return Response.json({
    ...base,
    window: "7 days",
    ai: { configured: cfg.enabled, model: cfg.enabled ? cfg.model : null, byMode: ai },
    marketProvider: { id: provider.id, label: provider.label, configured: provider.id !== "none" },
    jobs,
  });
}
