import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { setResearchAreas } from "@/lib/services/assessments";
import { addManualEvidence, deleteEvidence, LookupBody, ManualEvidenceBody, providerLookup } from "@/lib/services/market";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("manual"), evidence: ManualEvidenceBody }),
  z.object({ action: z.literal("lookup"), lookup: LookupBody }),
  z.object({ action: z.literal("delete"), evidenceId: z.string().uuid() }),
  z.object({ action: z.literal("areas"), areas: z.array(z.string().max(80)).max(3) }),
]);

/** POST /api/assessments/{id}/market — dated manual evidence, provider lookups, research areas. */
export const POST = route(async (req, ctx: RouteContext<"/api/assessments/[id]/market">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  switch (body.action) {
    case "manual":
      return Response.json(await addManualEvidence(auth, id, body.evidence, correlationId), { status: 201 });
    case "lookup":
      return Response.json(await providerLookup(auth, id, body.lookup, correlationId));
    case "delete":
      await deleteEvidence(auth, id, body.evidenceId, correlationId);
      return Response.json({ ok: true });
    case "areas":
      await setResearchAreas(auth, id, body.areas, correlationId);
      return Response.json({ ok: true });
  }
});
