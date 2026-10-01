import { requireAuth } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { startExport } from "@/lib/services/exports";

/** POST /api/reports/{id}/export — start PDF export for the exact report version (202 + job). */
export const POST = route(async (_req, ctx: RouteContext<"/api/reports/[id]/export">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const job = await startExport(auth, id, correlationId);
  return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
});
