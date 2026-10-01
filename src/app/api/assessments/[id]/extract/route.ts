import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { submitTurn } from "@/lib/services/assessments";

const Body = z.object({ text: z.string().min(1).max(50_000), idempotencyKey: z.string().min(8).max(100), expectedRevision: z.number().int().nonnegative() });

/** POST /api/assessments/{id}/extract — accept notes and return an extraction job ID (202). */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/extract">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  const res = await submitTurn(auth, id, { action: "notes", text: body.text, idempotencyKey: body.idempotencyKey, expectedRevision: body.expectedRevision }, correlationId);
  return Response.json({ jobId: res.jobId, duplicate: res.duplicate }, { status: 202 });
});
