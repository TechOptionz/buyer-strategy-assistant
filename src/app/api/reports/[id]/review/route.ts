import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { ReviewBody, reviewReport } from "@/lib/services/reports";

/** POST /api/reports/{id}/review — submit, approve or return for changes using the expected version. */
export const POST = route(async (req, ctx: RouteContext<"/api/reports/[id]/review">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = ReviewBody.parse(await readJson(req));
  return Response.json(await reviewReport(auth, id, body, correlationId));
});
