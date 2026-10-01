import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { invalid, notFound, readJson, route } from "@/lib/http";

const Perm = z.enum(["case_access_all", "edit_profile", "review", "manage_org"]);
const Role = z.enum(["org_admin", "buyer_agent", "reviewer"]);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    email: z.string().email().max(200),
    name: z.string().trim().min(1).max(120),
    role: Role,
    permissions: z.array(Perm).max(4),
    temporaryPassword: z.string().min(12).max(200),
  }),
  z.object({ action: z.literal("update"), userId: z.string().uuid(), role: Role, permissions: z.array(Perm).max(4) }),
]);

export const GET = route(async () => {
  const auth = await requireAuth();
  requireAdmin(auth);
  const db = await getDb();
  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, permissions: schema.memberships.permissions })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organisationId, auth.organisationId));
  return Response.json({ users: rows });
});

/** User and permission management. Every change is audited (Section 14). */
export const POST = route(async (req, _ctx, correlationId) => {
  const auth = await requireAuth();
  requireAdmin(auth);
  const body = Body.parse(await readJson(req));
  const db = await getDb();
  if (body.action === "create") {
    const email = body.email.toLowerCase();
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (existing) throw invalid("A user with this email already exists", { email: "Already registered" });
    const [user] = await db.insert(schema.users).values({ email, name: body.name, passwordHash: await bcrypt.hash(body.temporaryPassword, 10) }).returning({ id: schema.users.id });
    await db.insert(schema.memberships).values({ organisationId: auth.organisationId, userId: user.id, role: body.role, permissions: body.permissions });
    await audit(db, auth, { action: "user.create", objectType: "user", objectId: user.id, correlationId, detail: { role: body.role, permissions: body.permissions } });
    return Response.json({ id: user.id }, { status: 201 });
  }
  if (body.userId === auth.userId && body.role !== "org_admin") throw invalid("You cannot remove your own administrator role");
  const res = await db
    .update(schema.memberships)
    .set({ role: body.role, permissions: body.permissions })
    .where(and(eq(schema.memberships.organisationId, auth.organisationId), eq(schema.memberships.userId, body.userId)))
    .returning({ id: schema.memberships.id });
  if (!res.length) throw notFound("User");
  await audit(db, auth, { action: "permissions.change", objectType: "user", objectId: body.userId, correlationId, detail: { role: body.role, permissions: body.permissions } });
  return Response.json({ ok: true });
});
