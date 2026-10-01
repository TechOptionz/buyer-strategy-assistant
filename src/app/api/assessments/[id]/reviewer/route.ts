import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { SetReviewerBody, setReviewer } from "@/lib/services/assessments";

/** PUT /api/assessments/{id}/reviewer — assign or clear the case reviewer (assigned agent or admin). */
export const PUT = route(async (req, ctx: RouteContext<"/api/assessments/[id]/reviewer">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = SetReviewerBody.parse(await readJson(req));
  await setReviewer(auth, id, body.reviewerId, correlationId);
  return Response.json({ reviewerId: body.reviewerId });
});
