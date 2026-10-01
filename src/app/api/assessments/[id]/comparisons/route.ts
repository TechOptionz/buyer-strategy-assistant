import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { compareScenarios } from "@/lib/services/scenarios";

const Body = z.object({ scenarioIds: z.array(z.string().uuid()).min(2).max(3) });

/** POST /api/assessments/{id}/comparisons — compare up to three authorised scenario IDs. */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/comparisons">) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  return Response.json(await compareScenarios(auth, id, body.scenarioIds));
});
