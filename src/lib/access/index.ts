import "server-only";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "../auth/session";
import { getDb, schema } from "../db";
import { forbidden, notFound } from "../http";

export type Assessment = typeof schema.assessments.$inferSelect;

export const has = (ctx: AuthContext, p: AuthContext["permissions"][number]) => ctx.permissions.includes(p);

/** Case visibility: assigned agent, assigned reviewer, or an explicit case_access_all permission. */
export function canView(ctx: AuthContext, a: Assessment) {
  if (a.organisationId !== ctx.organisationId) return false;
  return a.assignedAgentId === ctx.userId || a.reviewerId === ctx.userId || has(ctx, "case_access_all");
}

/** Profile editing: the assigned agent, or anyone with case access plus the edit_profile permission. */
export function canEdit(ctx: AuthContext, a: Assessment) {
  if (!canView(ctx, a)) return false;
  return a.assignedAgentId === ctx.userId || has(ctx, "edit_profile");
}

/** Review: the assigned agent (self-review allowed by the state table), assigned reviewer, or review permission. */
export function canReview(ctx: AuthContext, a: Assessment) {
  if (!canView(ctx, a)) return false;
  return a.assignedAgentId === ctx.userId || a.reviewerId === ctx.userId || has(ctx, "review");
}

/**
 * Load an assessment for the authenticated organisation. Records from other organisations are
 * indistinguishable from missing ones (404), so their existence is never revealed.
 */
export async function loadAssessment(ctx: AuthContext, id: string, need: "view" | "edit" | "review" = "view") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Assessment");
  const db = await getDb();
  const [a] = await db
    .select()
    .from(schema.assessments)
    .where(and(eq(schema.assessments.id, id), eq(schema.assessments.organisationId, ctx.organisationId)))
    .limit(1);
  if (!a) throw notFound("Assessment");
  const ok = need === "view" ? canView(ctx, a) : need === "edit" ? canEdit(ctx, a) : canReview(ctx, a);
  if (!ok) throw forbidden();
  return a;
}

export function requireAdmin(ctx: AuthContext) {
  if (ctx.role !== "org_admin" && !has(ctx, "manage_org")) throw forbidden();
}
