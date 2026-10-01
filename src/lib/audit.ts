import "server-only";
import type { AuthContext } from "./auth/session";
import type { DB } from "./db";
import { schema } from "./db";

/** Record an audit event. `detail` must never contain buyer financial values — field paths and counts only. */
export async function audit(
  db: Pick<DB, "insert">,
  ctx: Pick<AuthContext, "organisationId" | "userId">,
  e: { action: string; objectType: string; objectId: string; assessmentId?: string | null; correlationId: string; detail?: Record<string, unknown> },
) {
  await db.insert(schema.auditEvents).values({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    action: e.action,
    objectType: e.objectType,
    objectId: e.objectId,
    assessmentId: e.assessmentId ?? null,
    correlationId: e.correlationId,
    detail: e.detail ?? null,
  });
}
