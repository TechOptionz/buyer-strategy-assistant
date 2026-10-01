import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { readJson, route } from "@/lib/http";

const Body = z.object({
  brandName: z.string().trim().min(1).max(120).optional(),
  reportFooter: z.string().max(300).optional(),
  attribution: z.string().max(500).optional(),
  retentionDays: z.number().int().min(30).max(36_500).optional(),
  freshnessDays: z.record(z.string().max(40), z.number().int().min(1).max(3650)).optional(),
});

/** Organisation branding, attribution, retention and evidence freshness settings. */
export const PATCH = route(async (req, _ctx, correlationId) => {
  const auth = await requireAuth();
  requireAdmin(auth);
  const body = Body.parse(await readJson(req));
  const db = await getDb();
  const [org] = await db.select().from(schema.organisations).where(eq(schema.organisations.id, auth.organisationId));
  const settings = { ...org.settings, ...body };
  await db.update(schema.organisations).set({ settings }).where(eq(schema.organisations.id, auth.organisationId));
  await audit(db, auth, { action: "settings.update", objectType: "organisation", objectId: auth.organisationId, correlationId, detail: { keys: Object.keys(body) } });
  return Response.json({ settings });
});
