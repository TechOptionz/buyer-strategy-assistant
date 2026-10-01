import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { submitTurn, TurnBody } from "@/lib/services/assessments";

/** POST /api/assessments/{id}/turns — save a turn once; returns new revision or a processing job. */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/turns">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = TurnBody.parse(await readJson(req));
  const res = await submitTurn(auth, id, body, correlationId);
  return Response.json(res, { status: res.jobId ? 202 : 200 });
});
