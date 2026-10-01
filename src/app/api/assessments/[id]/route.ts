import { requireAuth } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { getWorkspace } from "@/lib/services/assessments";

/** GET /api/assessments/{id} — current revision, profile, readiness and workspace state. */
export const GET = route(async (_req, ctx: RouteContext<"/api/assessments/[id]">) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  return Response.json(await getWorkspace(auth, id));
});
