import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/http";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// Simple per-instance throttle against password guessing.
const attempts = new Map<string, { n: number; until: number }>();

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const a = attempts.get(ip);
  if (a && a.until > Date.now() && a.n >= 10) throw new ApiError(429, "too_many_attempts", "Too many sign-in attempts. Try again in a few minutes.", {}, true);

  const body = Body.parse(await readJson(req));
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase()));
  const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : await bcrypt.compare(body.password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok) {
    const cur = attempts.get(ip);
    attempts.set(ip, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  }
  attempts.delete(ip);
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  if (!membership) throw new ApiError(403, "no_membership", "Your account is not a member of an organisation");
  await createSession(user.id, membership.organisationId);
  return Response.json({ ok: true });
});
