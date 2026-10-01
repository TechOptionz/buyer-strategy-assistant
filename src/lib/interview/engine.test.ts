import { describe, expect, it } from "vitest";
import { deriveProfile, type FactLike, ProfileView } from "../profile/state";
import { buildFromProfile } from "../scenario/build";
import { calculateScenario } from "../finance";
import { defaultOutputs, nextStep, readiness } from "./engine";

let n = 0;
const fact = (path: string, value: unknown, extra: Partial<FactLike> = {}): FactLike => ({
  id: `f${++n}`,
  fieldPath: path,
  valueState: "value",
  value,
  status: "confirmed",
  sourceType: "structured_entry",
  sourceId: null,
  evidenceText: null,
  confirmedById: "u1",
  confirmedAt: new Date(2026, 9, 1, 9, n).toISOString(),
  createdAt: new Date(2026, 9, 1, 9, n).toISOString(),
  proposedBy: "agent",
  ...extra,
});
const view = (facts: FactLike[]) => new ProfileView(deriveProfile(facts));
const ctx = (v: ProfileView) => ({ skipped: new Set<string>(), requestedOutputs: defaultOutputs(v), goalConflicts: [] });
const qKey = (v: ProfileView) => {
  const s = nextStep(v, ctx(v));
  return s.kind === "question" ? s.question.key : s.kind;
};

describe("CON02 question order", () => {
  it("asks purpose first", () => {
    expect(qKey(view([]))).toBe("purchase_purpose");
  });
  it("resolves blocking contradictions before anything else", () => {
    const v = view([fact("funds.cash", 8_000_000), fact("funds.cash", 9_500_000)]);
    expect(nextStep(v, ctx(v)).kind).toBe("conflict");
  });
});

describe("AT03 eligibility", () => {
  it("confirmed facts suppress duplicate questions", () => {
    const v = view([fact("goals.purchasePurpose", "investment"), fact("goals.timing", "0-3m")]);
    expect(qKey(v)).not.toBe("purchase_purpose");
    expect(qKey(v)).not.toBe("purchase_timing");
  });
  it("purpose change recalculates eligibility (CON03 branching)", () => {
    const base = [fact("goals.timing", "0-3m")];
    expect(qKey(view([...base, fact("goals.purchasePurpose", "ppor")]))).toBe("household_needs");
    expect(qKey(view([...base, fact("goals.purchasePurpose", "investment")]))).toBe("holding_period");
  });
  it("PPOR path has no rental cashflow output", () => {
    const v = view([fact("goals.purchasePurpose", "ppor")]);
    expect(readiness(v, { evidenceByArea: {} }).some((r) => r.output === "rental_cashflow")).toBe(false);
  });
  it("per-property questions refer to supplied information", () => {
    const v = view([fact("goals.purchasePurpose", "investment"), fact("portfolio.propertyCount", 2), fact("goals.timing", "0-3m"), fact("goals.holdingPeriodYears", 10), fact("goals.incomeVsGrowth", "growth"), fact("goals.comfortableMonthlyContribution", 0), fact("preferences.areas", ["Ipswich"]), fact("preferences.areasMandatory", "flexible"), fact("preferences.propertyType", "house"), fact("preferences.bedroomsMin", 3)]);
    const s = nextStep(v, ctx(v));
    expect(s.kind === "question" && s.question.instanceKey).toBe("property_value:1");
    expect(s.kind === "question" && s.question.prompt).toContain("property 1");
  });
});

describe("Section 6 readiness", () => {
  it("unknown borrowing scope leaves the funding ceiling unresolved", () => {
    const v = view([
      fact("goals.purchasePurpose", "investment"),
      fact("portfolio.propertyCount", 1),
      fact("funding.equityDrawRequested", true),
      fact("finance.equityDrawAmount", 12_000_000),
      fact("finance.limitScope", "not_sure"),
      fact("funds.cash", 1), fact("funds.protectedReserve", 0), fact("funds.earmarked", 0),
      fact("scenario.purchaseCosts", 1), fact("finance.lvrCapPct", 80), fact("finance.borrowingLimit", 1),
    ]);
    const r = readiness(v, { evidenceByArea: {} }).find((x) => x.output === "funding_ceiling")!;
    expect(r.status).not.toBe("ready");
    expect(r.unresolved.join(" ")).toMatch(/scope unresolved/);
  });
  it("affordability needs a confirmed finance assessment, not just a ceiling", () => {
    const v = view([fact("goals.purchasePurpose", "ppor"), fact("finance.confirmationStatus", "broker_estimate")]);
    const r = readiness(v, { evidenceByArea: {} }).find((x) => x.output === "affordability_conclusion")!;
    expect(r.status).not.toBe("ready");
    expect(r.summary).toMatch(/funding ceiling alone cannot establish affordability/);
  });
});

describe("profile → scenario", () => {
  it("unknown costs stay unknown and block the cash requirement", () => {
    const v = view([fact("goals.purchasePurpose", "investment"), fact("scenario.targetPrice", 80_000_000), fact("scenario.purchaseCosts", null, { valueState: "unknown" })]);
    const { inputs, kinds } = buildFromProfile(v);
    expect(inputs.purchaseCosts[0].amountCents).toBeNull();
    expect(kinds.purchaseCosts).toBe("missing");
    expect(calculateScenario(inputs).funding.cashRequiredCents).toBeNull();
  });
  it("derived loan is labelled as an assumption", () => {
    const v = view([fact("goals.purchasePurpose", "investment"), fact("scenario.targetPrice", 80_000_000), fact("finance.lvrCapPct", 80)]);
    const { inputs, kinds, labels } = buildFromProfile(v);
    expect(inputs.purchaseLoan.principalCents).toBe(64_000_000);
    expect(kinds["purchaseLoan.principalCents"]).toBe("assumed");
    expect(labels["purchaseLoan.principalCents"]).toMatch(/assumed/);
  });
  it("superannuation is visible but never counted as funding (AT10)", () => {
    const v = view([fact("goals.purchasePurpose", "investment"), fact("funds.cash", 10_000_000), fact("super.balance", 30_000_000), fact("funds.protectedReserve", 0), fact("funds.earmarked", 0)]);
    const r = calculateScenario(buildFromProfile(v).inputs);
    expect(r.funding.committedCashCents).toBe(10_000_000);
    expect(r.funding.excludedSources.map((e) => e.id)).toContain("super");
  });
});
