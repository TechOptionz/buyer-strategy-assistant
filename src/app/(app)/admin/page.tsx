import Link from "next/link";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { aiConfig } from "@/lib/ai/config";
import { requireAuth } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/format";
import { QUESTIONS, REGISTRY_VERSION, OUTPUT_LABELS } from "@/lib/interview/registry";
import { METRICS } from "@/lib/market/metrics";
import { getProvider } from "@/lib/market/provider";
import { AdminClient, type AdminProps } from "./AdminClient";

export const metadata = { title: "Administration · Buyer Strategy Assistant" };

export default async function AdminPage() {
  const auth = await requireAuth();
  const isAdmin = auth.role === "org_admin" || auth.permissions.includes("manage_org");
  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 md:p-8">
        <div role="alert" className="flex max-w-[440px] flex-col gap-2 rounded-lg border border-line bg-surface px-8 py-7">
          <h1 className="text-base font-semibold text-ink">Administration is limited to organisation administrators</h1>
          <p className="text-[13px] leading-[1.55] text-ink-secondary">
            Your role is {ROLE_LABEL[auth.role] ?? auth.role}. Ask an administrator if you need to change users, providers or branding.
          </p>
          <Link href="/cases" className="mt-1 text-[13px]">
            Back to cases
          </Link>
        </div>
      </div>
    );
  }

  const db = await getDb();
  const [org] = await db
    .select({ name: schema.organisations.name, settings: schema.organisations.settings })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, auth.organisationId));
  const members = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.memberships.role,
      permissions: schema.memberships.permissions,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organisationId, auth.organisationId))
    .orderBy(asc(schema.users.name));

  // Cases each member is assigned to as agent or reviewer — the basis of case access in canView().
  const caseCounts = await db
    .select({ userId: schema.memberships.userId, n: sql<number>`count(distinct ${schema.assessments.id})::int` })
    .from(schema.memberships)
    .innerJoin(
      schema.assessments,
      and(
        eq(schema.assessments.organisationId, schema.memberships.organisationId),
        or(eq(schema.assessments.assignedAgentId, schema.memberships.userId), eq(schema.assessments.reviewerId, schema.memberships.userId)),
      ),
    )
    .where(eq(schema.memberships.organisationId, auth.organisationId))
    .groupBy(schema.memberships.userId);
  const countByUser = new Map(caseCounts.map((c) => [c.userId, Number(c.n)]));

  const ai = aiConfig();
  const provider = getProvider();
  const settings = org?.settings ?? {};

  const props: AdminProps = {
    currentUserId: auth.userId,
    canViewHealthMetrics: auth.role === "org_admin",
    organisationName: org?.name ?? auth.organisationName,
    members: members.map((m) => ({ ...m, permissions: [...(m.permissions ?? [])], assignedCases: countByUser.get(m.userId) ?? 0 })),
    settings: {
      brandName: settings.brandName ?? "",
      reportFooter: settings.reportFooter ?? "",
      attribution: settings.attribution ?? "",
      retentionDays: settings.retentionDays ?? null,
      freshnessDays: { ...(settings.freshnessDays ?? {}) },
    },
    metrics: METRICS.map((m) => ({ key: m.key, label: m.label, help: m.help, defaultFreshDays: m.defaultFreshDays })),
    ai: { configured: ai.enabled, provider: ai.provider, model: ai.enabled ? ai.model : null },
    marketProvider: { id: provider.id, label: provider.label, configured: provider.id !== "none" },
    interview: {
      version: REGISTRY_VERSION,
      questions: QUESTIONS.map((q) => ({
        key: q.key,
        topic: String(q.topic),
        prompt: q.prompt,
        answerType: q.answerType,
        requiredFor: q.requiredFor.map((o) => OUTPUT_LABELS[o] ?? o),
        optional: q.optional,
        priority: q.priority,
        perProperty: !!q.perProperty,
      })),
    },
  };

  return <AdminClient {...props} />;
}
