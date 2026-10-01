import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { CreateReportBody, createReport } from "@/lib/services/reports";

/** POST /api/assessments/{id}/reports — create a report draft from named snapshots. */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/reports">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = CreateReportBody.parse(await readJson(req));
  return Response.json(await createReport(auth, id, body, correlationId), { status: 201 });
});
