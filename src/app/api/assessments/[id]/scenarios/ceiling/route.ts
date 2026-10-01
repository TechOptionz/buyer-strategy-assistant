import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { calculateCeiling, CeilingBody } from "@/lib/services/scenarios";

/** POST /api/assessments/{id}/scenarios/ceiling — funding ceiling search (not loan approval). */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/scenarios/ceiling">) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = CeilingBody.parse(await readJson(req));
  return Response.json(await calculateCeiling(auth, id, body));
});
