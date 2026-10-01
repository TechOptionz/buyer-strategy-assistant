import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { deriveProfile, profileSnapshot, type FactLike } from "../profile/state";
import * as schema from "./schema";

/**
 * FICTIONAL development seed data. Every person, amount and market figure below is invented for
 * testing and is labelled as such in the UI. Never present it as live provider data.
 *
 * Demo logins (all share one password):
 *   admin@demo.test     organisation administrator (explicit case access)
 *   agent@demo.test     buyer agent (assigned to the seed cases)
 *   reviewer@demo.test  reviewer (assigned to review seed cases)
 *   other@other.test    agent in a second organisation, for isolation testing
 * Password: SEED_PASSWORD env var, or the development default below when not in production.
 */
const DEV_DEFAULT_PASSWORD = "BuyerDemo-2026!";

type DB = NodePgDatabase<typeof schema>;
const $ = (dollars: number) => Math.round(dollars * 100);

export async function seedIfEmpty(db: DB) {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(schema.organisations);
  if (existing[0].n > 0) return false;
  await seed(db);
  return true;
}

export async function seed(db: DB) {
  const password = process.env.SEED_PASSWORD ?? (process.env.NODE_ENV === "production" && !process.env.ALLOW_EPHEMERAL_DB ? null : DEV_DEFAULT_PASSWORD);
  if (!password) throw new Error("Set SEED_PASSWORD to seed a production database.");
  const hash = await bcrypt.hash(password, 10);

  const [orgA] = await db
    .insert(schema.organisations)
    .values({ name: "Demo Buyers Agency (fictional)", settings: { brandName: "Demo Buyers Agency", reportFooter: "Fictional demonstration organisation", retentionDays: 2555 } })
    .returning();
  const [orgB] = await db.insert(schema.organisations).values({ name: "Other Agency (isolation test)", settings: {} }).returning();

  const mk = async (email: string, name: string) => (await db.insert(schema.users).values({ email, name, passwordHash: hash }).returning())[0];
  const admin = await mk("admin@demo.test", "Alex Admin");
  const agent = await mk("agent@demo.test", "Sam Agent");
  const reviewer = await mk("reviewer@demo.test", "Riley Reviewer");
  const other = await mk("other@other.test", "Olive Other");
  await db.insert(schema.memberships).values([
    { organisationId: orgA.id, userId: admin.id, role: "org_admin", permissions: ["manage_org", "case_access_all", "edit_profile", "review"] },
    { organisationId: orgA.id, userId: agent.id, role: "buyer_agent", permissions: [] },
    { organisationId: orgA.id, userId: reviewer.id, role: "reviewer", permissions: ["review"] },
    { organisationId: orgB.id, userId: other.id, role: "buyer_agent", permissions: [] },
  ]);

  const makeCase = async (
    org: string,
    agentId: string,
    name: string,
    entryMode: "notes" | "guided",
    confirmed: [string, unknown][],
    extra: { conflicts?: [string, unknown, unknown][]; proposed?: [string, unknown, string][]; turns?: { author: "agent" | "assistant" | "buyer"; kind: "notes" | "question" | "answer" | "message"; text: string }[] } = {},
  ) => {
    const [a] = await db
      .insert(schema.assessments)
      .values({ organisationId: org, buyerDisplayName: name, assignedAgentId: agentId, reviewerId: org === orgA.id ? reviewer.id : null, entryMode, isSeed: true, currentRevision: 1 })
      .returning();
    const now = new Date();
    const rows: (typeof schema.facts.$inferInsert)[] = confirmed.map(([path, value]) => ({
      organisationId: org, assessmentId: a.id, fieldPath: path, valueState: "value", value: value as never,
      sourceType: "structured_entry", evidenceText: "Seed data (fictional)", status: "confirmed", revision: 1, proposedBy: "agent", confirmedById: agentId, confirmedAt: now,
    }));
    for (const [path, v1, v2] of extra.conflicts ?? []) {
      for (const [v, ev] of [[v1, "Intake form: savings (fictional)"], [v2, "Later phone call: savings (fictional)"]] as const)
        rows.push({ organisationId: org, assessmentId: a.id, fieldPath: path, valueState: "value", value: v as never, sourceType: "conversation", evidenceText: ev, status: "confirmed", revision: 1, proposedBy: "agent", confirmedById: agentId, confirmedAt: now });
    }
    for (const [path, value, evidence] of extra.proposed ?? [])
      rows.push({ organisationId: org, assessmentId: a.id, fieldPath: path, valueState: "value", value: value as never, sourceType: "notes", evidenceText: evidence, confidence: "medium", status: "proposed", revision: 1, proposedBy: "rules" });
    const inserted = rows.length ? await db.insert(schema.facts).values(rows).returning() : [];
    const state = deriveProfile(inserted.map((r) => ({ ...r, value: r.value }) as FactLike));
    await db.insert(schema.profileRevisions).values({ organisationId: org, assessmentId: a.id, revision: 1, snapshot: profileSnapshot(state), changedPaths: confirmed.map(([p]) => p), changeSummary: "Seed data", createdById: agentId });
    let seq = 1;
    for (const t of extra.turns ?? [])
      await db.insert(schema.turns).values({ organisationId: org, assessmentId: a.id, sequence: seq++, author: t.author, kind: t.kind, text: t.text, idempotencyKey: `seed-${a.id}-${seq}`, extractionStatus: t.kind === "notes" ? "done" : "none" });
    if (extra.conflicts?.length) await db.update(schema.assessments).set({ status: "needs_clarification" }).where(sql`${schema.assessments.id} = ${a.id}`);
    return a;
  };

  // 1. First-time buyer, PPOR, part-way through the interview.
  await makeCase(orgA.id, agent.id, "Priya & Tom Example (fictional first-home buyers)", "guided", [
    ["goals.purchasePurpose", "ppor"],
    ["goals.timing", "3-6m"],
    ["goals.householdNeeds", "Close to a primary school; room for a home office"],
    ["portfolio.propertyCount", 0],
    ["preferences.areas", ["Wynnum", "Manly West"]],
    ["preferences.areasMandatory", "flexible"],
    ["preferences.propertyType", "house"],
    ["preferences.bedroomsMin", 3],
    ["funds.cash", $(145_000)],
    ["funds.protectedReserve", $(20_000)],
    ["funds.earmarked", 0],
    ["household.income.amount", $(3_900)],
    ["household.income.frequency", "weekly"],
    ["household.income.basis", "net"],
  ]);

  // 2. Investor with an existing home and loan — mirrors the spec's numerical fixture.
  const investor = await makeCase(orgA.id, agent.id, "Marcus Example (fictional investor)", "guided", [
    ["goals.purchasePurpose", "investment"],
    ["goals.timing", "0-3m"],
    ["goals.holdingPeriodYears", 10],
    ["goals.incomeVsGrowth", "balanced"],
    ["goals.comfortableMonthlyContribution", $(2_000)],
    ["portfolio.propertyCount", 1],
    ["properties.1.address", "Existing home (fictional)"],
    ["properties.1.value", $(900_000)],
    ["properties.1.debt", $(500_000)],
    ["properties.1.intention", "keep"],
    ["properties.1.ownershipStructure", "sole"],
    ["funds.cash", $(120_000)],
    ["funds.protectedReserve", $(30_000)],
    ["funds.earmarked", 0],
    ["funding.equityDrawRequested", true],
    ["finance.equityDrawAmount", $(120_000)],
    ["finance.borrowingLimit", $(760_000)],
    ["finance.limitScope", "includes_equity_draw"],
    ["finance.confirmationStatus", "broker_estimate"],
    ["finance.lvrCapPct", 80],
    ["finance.interestRatePct", 6.5],
    ["finance.repaymentType", "interest_only"],
    ["finance.loanTermYears", 30],
    ["scenario.targetPrice", $(800_000)],
    ["scenario.purchaseCosts", $(40_000)],
    ["scenario.expectedWeeklyRent", $(750)],
    ["scenario.vacantWeeks", 2],
    ["scenario.annualOperatingCosts", $(7_500)],
    ["preferences.areas", ["Ipswich", "Logan Central"]],
    ["preferences.areasMandatory", "flexible"],
    ["preferences.propertyType", "house"],
    ["preferences.bedroomsMin", 3],
  ]);
  const sample = (area: string, metric: string, value: number, unit: string) => ({
    organisationId: orgA.id, assessmentId: investor.id, provider: "sample", area, propertyType: "house", metric, valueNumeric: String(value), unit,
    periodEnd: "2026-08-31", sourceDescription: "SAMPLE DEVELOPMENT DATA — fictional, not market evidence", observedAt: "2026-09-15", isSample: true, quality: { sample: true },
  });
  await db.insert(schema.marketEvidence).values([
    sample("Ipswich", "median_sale_price", 640_000, "AUD"),
    sample("Ipswich", "vacancy_rate", 1.4, "%"),
    sample("Ipswich", "gross_rental_yield", 4.9, "%"),
    sample("Logan Central", "median_sale_price", 720_000, "AUD"),
    sample("Logan Central", "vacancy_rate", 2.6, "%"),
  ]);

  // 3. Incomplete and contradictory case: two confirmed savings figures plus unreviewed notes.
  const notes =
    "Jordan wants to buy something to rent out. I earn 8k. We have 200k equity in our place. Budget around $650k. Looking in Redbank Plains or Springfield.";
  await makeCase(
    orgA.id,
    agent.id,
    "Jordan Example (fictional, contradictory)",
    "notes",
    [["goals.purchasePurpose", "investment"]],
    {
      conflicts: [["funds.cash", $(80_000), $(95_000)]],
      proposed: [
        ["household.income.amount", $(8_000), "I earn 8k."],
        ["preferences.budgetMax", $(650_000), "Budget around $650k."],
        ["preferences.areas", ["Redbank Plains", "Springfield"], "Looking in Redbank Plains or Springfield."],
      ],
      turns: [
        { author: "agent", kind: "notes", text: notes },
        { author: "assistant", kind: "question", text: 'Clarification needed: "8k" income — is that per week, fortnight, month or year?' },
        { author: "assistant", kind: "question", text: 'Clarification needed: "200k equity" — is that the property value minus the loan, or the amount a lender would let you borrow against it? We need the property value and loan balance separately.' },
      ],
    },
  );

  // Other organisation's case — must never be visible to org A users.
  await makeCase(orgB.id, other.id, "Other Org Buyer (fictional)", "guided", [["goals.purchasePurpose", "ppor"]]);
  return { orgA: orgA.id, orgB: orgB.id };
}
