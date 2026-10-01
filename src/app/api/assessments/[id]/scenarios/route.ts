import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { parseWhatIf } from "@/lib/finance/whatif";
import { describeChange } from "@/lib/finance/patch";
import { archiveScenario, CreateScenarioBody, createScenario } from "@/lib/services/scenarios";
import { loadAssessment } from "@/lib/access";

const Body = z.union([
  CreateScenarioBody.extend({ action: z.literal("create") }),
  z.object({ action: z.literal("archive"), scenarioId: z.string().uuid() }),
  z.object({ action: z.literal("interpret"), text: z.string().min(1).max(500) }),
]);

/**
 * POST /api/assessments/{id}/scenarios
 * - create: validate and calculate an immutable scenario for a named profile revision.
 * - interpret: turn a natural-language what-if into a PROPOSED patch (nothing is calculated).
 * - archive: hide a scenario from the lab (it stays reproducible).
 */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/scenarios">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  if (body.action === "interpret") {
    await loadAssessment(auth, id, "view");
    const proposal = parseWhatIf(body.text);
    return Response.json({
      ...proposal,
      described: proposal.changes.map(describeChange),
      clarifications: proposal.clarifications.map((c) => ({ ...c, options: c.options.map((o) => ({ ...o, described: o.changes.map(describeChange) })) })),
    });
  }
  if (body.action === "archive") {
    await archiveScenario(auth, id, body.scenarioId, correlationId);
    return Response.json({ ok: true });
  }
  const res = await createScenario(auth, id, body, correlationId);
  return Response.json(res, { status: res.duplicate ? 200 : 201 });
});
