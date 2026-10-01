import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/session";
import { schema } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { loadReport, UpdateReportBody, updateReport } from "@/lib/services/reports";

/** GET /api/reports/{id} — full report (snapshot, sections, review state, exports). */
export const GET = route(async (_req, ctx: RouteContext<"/api/reports/[id]">) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const { report, db } = await loadReport(auth, id, "view");
  const exports = await db.select({ id: schema.exports.id, createdAt: schema.exports.createdAt, byteSize: schema.exports.byteSize }).from(schema.exports).where(eq(schema.exports.reportId, id));
  return Response.json({ ...report, exports });
});

/** PATCH /api/reports/{id} — edit agent commentary and next actions on a draft (expected row version). */
export const PATCH = route(async (req, ctx: RouteContext<"/api/reports/[id]">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = UpdateReportBody.parse(await readJson(req));
  return Response.json(await updateReport(auth, id, body, correlationId));
});
