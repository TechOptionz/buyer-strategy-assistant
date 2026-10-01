import "server-only";
import { and, eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDb, schema } from "../db";
import type { Permission, Role } from "../db/schema";
import { ApiError } from "../http";

export const SESSION_COOKIE = "bsa_session";
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ chars) is required in production");
    return new TextEncoder().encode("dev-only-session-secret-not-for-production-use");
  }
  return new TextEncoder().encode(s);
}

export interface AuthContext {
  userId: string;
  name: string;
  email: string;
  organisationId: string;
  organisationName: string;
  role: Role;
  permissions: Permission[];
}

export async function createSession(userId: string, organisationId: string) {
  const token = await new SignJWT({ org: organisationId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Organisation is derived from the authenticated membership, never from a request body. */
export async function getAuth(): Promise<AuthContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  let org: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret());
    sub = payload.sub;
    org = payload.org as string | undefined;
  } catch {
    return null;
  }
  if (!sub || !org) return null;
  const db = await getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      organisationId: schema.organisations.id,
      organisationName: schema.organisations.name,
      role: schema.memberships.role,
      permissions: schema.memberships.permissions,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.organisations, eq(schema.organisations.id, schema.memberships.organisationId))
    .where(and(eq(schema.memberships.userId, sub), eq(schema.memberships.organisationId, org)))
    .limit(1);
  return rows[0] ?? null;
}

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) throw new ApiError(401, "unauthenticated", "Please sign in");
  return ctx;
}
