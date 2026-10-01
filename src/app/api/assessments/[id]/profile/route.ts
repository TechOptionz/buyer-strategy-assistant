import { z } from "zod";
import { loadAssessment } from "@/lib/access";
import { requireAuth } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { syncStatus } from "@/lib/services/assessments";
import { confirmFacts, rejectFacts, resolveConflict, setConfirmedFields } from "@/lib/services/profile";

const ValueState = z.enum(["value", "unknown", "not_applicable", "declined"]);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    expectedRevision: z.number().int().nonnegative(),
    fields: z.array(z.object({ path: z.string().max(80), valueState: ValueState, value: z.unknown().optional() })).min(1).max(50),
  }),
  z.object({
    action: z.literal("confirm"),
    expectedRevision: z.number().int().nonnegative(),
    items: z.array(z.object({ factId: z.string().uuid(), value: z.unknown().optional() })).min(1).max(100),
  }),
  z.object({ action: z.literal("reject"), factIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({
    action: z.literal("resolve"),
    expectedRevision: z.number().int().nonnegative(),
    path: z.string().max(80),
    keepFactId: z.string().uuid().optional(),
    valueState: ValueState.optional(),
    value: z.unknown().optional(),
  }),
]);

/**
 * PATCH /api/assessments/{id}/profile — apply confirmed fields against an expected revision.
 * Stale edits return 409; validation failures return 422.
 */
export const PATCH = route(async (req, ctx: RouteContext<"/api/assessments/[id]/profile">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  await loadAssessment(auth, id, "edit");
  const body = Body.parse(await readJson(req));
  const db = await getDb();
  let revision: number | undefined;
  switch (body.action) {
    case "set":
      revision = await setConfirmedFields(db, auth, id, body.expectedRevision, body.fields as never, { type: "structured_entry" }, correlationId);
      break;
    case "confirm":
      revision = await confirmFacts(db, auth, id, body.expectedRevision, body.items, correlationId);
      break;
    case "reject":
      await rejectFacts(db, auth, id, body.factIds, correlationId);
      break;
    case "resolve":
      revision = await resolveConflict(
        db,
        auth,
        id,
        body.expectedRevision,
        body.path,
        body.keepFactId ? { keepFactId: body.keepFactId } : { valueState: body.valueState ?? "value", value: body.value },
        correlationId,
      );
      break;
  }
  await syncStatus(db, id);
  return Response.json({ revision });
});
