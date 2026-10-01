import { describe, expect, it } from "vitest";
import {
  applyChanges,
  buildSchedule,
  calculateScenario,
  compareResults,
  fundingCeiling,
  parseWhatIf,
  type ScenarioInputs,
} from "./index";

const $ = (dollars: number) => Math.round(dollars * 100);

/** Section 15 hypothetical fixture — synthetic values, both new loans interest-only throughout. */
export function fixtureInputs(): ScenarioInputs {
  return {
    purpose: "investment",
    purchasePriceCents: $(800_000),
    lenderValuationCents: $(800_000),
    purchaseCosts: [{ label: "Purchase costs", amountCents: $(40_000), basis: "manual" }],
    purchaseLoan: { principalCents: $(640_000), ratePct: 6.5, termMonths: 360, repayment: "interest_only" },
    equityDraw: { principalCents: $(120_000), allocatedCents: $(120_000), ratePct: 6.5, termMonths: 360, repayment: "interest_only" },
    fundingSources: [{ id: "cash", label: "Cash", kind: "cash", amountCents: $(120_000), linkedTo: "bank-savings" }],
    protectedReserveCents: $(30_000),
    otherEarmarkedCents: 0,
    existingSecurity: { propertyValueCents: $(900_000), securedDebtCents: $(500_000), assumedLvrCapPct: 80 },
    borrowingLimit: { amountCents: $(760_000), scope: "includes_equity_draw", confirmed: true },
    rent: { weeklyCents: $(750), vacantWeeks: 2 },
    operatingCosts: [{ label: "Annual operating costs", amountCents: $(7_500) }],
    financeConfirmed: false,
  };
}

const downside = () =>
  applyChanges(fixtureInputs(), [
    { op: "set_rate", pct: 8.5 },
    { op: "set_weekly_rent", cents: $(675) },
    { op: "set_vacant_weeks", weeks: 4 },
  ]);

describe("AT08 numerical fixture", () => {
  const base = calculateScenario(fixtureInputs());
  const down = calculateScenario(downside());

  it.each([
    ["theoretical headroom", (r: typeof base) => r.funding.theoreticalHeadroomCents, 220_000, 220_000],
    ["funding available excl reserve", (r: typeof base) => r.funding.availableFundingCents, 210_000, 210_000],
    ["cash required at settlement", (r: typeof base) => r.funding.cashRequiredCents, 200_000, 200_000],
    ["cash remaining incl reserve", (r: typeof base) => r.funding.cashRemainingIncludingReserveCents, 40_000, 40_000],
    ["gross annual rent", (r: typeof base) => r.cashflow.scheduledAnnualRentCents, 39_000, 35_100],
    ["collected annual rent", (r: typeof base) => r.cashflow.collectedAnnualRentCents, 37_500, 32_400],
    ["net operating income", (r: typeof base) => r.cashflow.netOperatingIncomeCents, 30_000, 24_900],
    ["annual incremental debt service", (r: typeof base) => r.cashflow.annualIncrementalDebtServiceCents, 49_400, 64_600],
    ["annual incremental cashflow", (r: typeof base) => r.cashflow.annualIncrementalCashflowCents, -19_400, -39_700],
    ["average monthly cashflow", (r: typeof base) => r.cashflow.averageMonthlyCashflowCents, -1_616.67, -3_308.33],
  ])("%s", (_name, get, b, d) => {
    expect(Math.abs((get(base) as number) - $(b))).toBeLessThanOrEqual(1);
    expect(Math.abs((get(down) as number) - $(d))).toBeLessThanOrEqual(1);
  });

  it("yields match stated precision", () => {
    expect(base.cashflow.grossRentalYieldPct).toBe("4.8750");
    expect(base.cashflow.netRentalYieldPct).toBe("3.7500");
    expect(down.cashflow.grossRentalYieldPct).toBe("4.3875");
    expect(down.cashflow.netRentalYieldPct).toBe("3.1125");
  });

  it("debt service splits purchase loan and equity draw", () => {
    expect(base.cashflow.purchaseLoanAnnualDebtServiceCents).toBe($(41_600));
    expect(base.cashflow.equityDrawAnnualDebtServiceCents).toBe($(7_800));
  });

  it("funding and borrowing checks pass; serviceability stays unresolved", () => {
    const byKey = Object.fromEntries(base.checks.map((c) => [c.key, c.outcome]));
    expect(byKey.funding).toBe("pass");
    expect(byKey.borrowing_limit).toBe("pass");
    expect(byKey.equity_headroom).toBe("pass");
    expect(byKey.serviceability).toBe("unresolved");
  });
});

describe("AT09 equity loan debt service", () => {
  it("omitting the equity loan from cashflow changes the result (test fails the fixture)", () => {
    const noEquity = { ...fixtureInputs(), equityDraw: null };
    const r = calculateScenario(noEquity);
    expect(r.cashflow.annualIncrementalDebtServiceCents).not.toBe($(49_400));
  });
  it("unallocated borrowed cash is still subject to debt service", () => {
    const i = fixtureInputs();
    i.equityDraw!.principalCents = $(150_000);
    i.equityDraw!.allocatedCents = $(120_000);
    const r = calculateScenario(i);
    expect(r.cashflow.equityDrawAnnualDebtServiceCents).toBe($(9_750));
    expect(r.funding.equityDrawUnallocatedCents).toBe($(30_000));
    expect(r.funding.availableFundingCents).toBe($(210_000));
    expect(r.funding.cashRemainingIncludingReserveCents).toBe($(70_000));
  });
});

describe("AT10 no double counting", () => {
  it("super and loan proceeds are excluded from funding", () => {
    const i = fixtureInputs();
    i.fundingSources.push(
      { id: "super", label: "Super", kind: "super", amountCents: $(300_000) },
      { id: "lp", label: "Drawn loan proceeds", kind: "loan_proceeds", amountCents: $(120_000) },
    );
    const r = calculateScenario(i);
    expect(r.funding.availableFundingCents).toBe($(210_000));
    expect(r.funding.excludedSources.map((e) => e.id).sort()).toEqual(["lp", "super"]);
  });
  it("offset and cash drawing on the same account are rejected", () => {
    const i = fixtureInputs();
    i.fundingSources.push({ id: "offset", label: "Offset", kind: "offset", amountCents: $(120_000), linkedTo: "bank-savings" });
    const r = calculateScenario(i);
    expect(r.funding.status).toBe("invalid");
    expect(r.funding.availableFundingCents).toBe($(210_000));
  });
});

describe("AT11 funding ceiling", () => {
  const params = { minPriceCents: $(300_000), maxPriceCents: $(1_500_000), stepCents: $(5_000), valuationPctOfPrice: 100, purchaseLvrCapPct: 80, fixedCostsCents: $(40_000), costsPctOfPrice: 0 };
  it("unknown borrowing scope prevents a confirmed ceiling", () => {
    const i = fixtureInputs();
    i.borrowingLimit!.scope = "unknown";
    const r = fundingCeiling(i, params);
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") expect(r.missing).toContain("borrowingLimit.scope");
  });
  it("insufficient funds return no feasible scenario", () => {
    const i = fixtureInputs();
    i.fundingSources = [{ id: "cash", label: "Cash", kind: "cash", amountCents: $(30_000) }];
    i.equityDraw = null;
    i.borrowingLimit = { amountCents: $(760_000), scope: "purchase_loan_only", confirmed: true };
    expect(fundingCeiling(i, params).status).toBe("no_feasible_scenario");
  });
  it("returns the highest feasible price rounded down to precision", () => {
    const r = fundingCeiling(fixtureInputs(), params);
    expect(r.status).toBe("feasible");
    // Loan capped at 640k by limit (760k - 120k equity). Funds 210k: P + 40k - 640k <= 210k → P <= 810k.
    if (r.status === "feasible") {
      expect(r.priceCents).toBe($(810_000));
      expect(r.bindingConstraint).toBe("available_funding_with_borrowing_limit");
    }
  });
});

describe("AT12 loan schedules", () => {
  it("zero-rate loan amortises principal evenly", () => {
    const s = buildSchedule({ principalCents: $(12_000), ratePct: 0, termMonths: 12, repayment: "principal_and_interest" });
    expect(s.status).toBe("complete");
    if (s.status === "complete") {
      expect(s.rows.every((r) => r.paymentCents === $(1_000))).toBe(true);
      expect(s.rows.at(-1)!.closingCents).toBe(0);
    }
  });
  it("nonzero-rate schedule reconciles the final balance to zero", () => {
    const s = buildSchedule({ principalCents: $(500_000), ratePct: 6.25, termMonths: 360, repayment: "principal_and_interest" });
    if (s.status !== "complete") throw new Error("expected complete");
    expect(s.rows[0].paymentCents).toBe(307_859); // annuity payment $3,078.586… → $3,078.59
    expect(s.rows.at(-1)!.closingCents).toBe(0);
  });
  it("interest-only expiry amortises over the remaining term", () => {
    const s = buildSchedule({ principalCents: $(100_000), ratePct: 6, termMonths: 120, repayment: "interest_only", interestOnlyMonths: 60 });
    if (s.status !== "complete") throw new Error("expected complete");
    expect(s.rows[59].paymentCents).toBe($(500));
    expect(s.rows[59].closingCents).toBe($(100_000));
    // 100k over remaining 60 months at 6% → $1,933.28
    expect(s.rows[60].paymentCents).toBe(193_328);
    expect(s.rows.at(-1)!.closingCents).toBe(0);
  });
  it("rejects zero or negative terms and invalid percentages", () => {
    expect(buildSchedule({ principalCents: 1, ratePct: 5, termMonths: 0, repayment: "principal_and_interest" }).status).toBe("invalid");
    expect(buildSchedule({ principalCents: 1, ratePct: -1, termMonths: 12, repayment: "principal_and_interest" }).status).toBe("invalid");
  });
  it("rate changes apply from the declared month", () => {
    const s = buildSchedule({ principalCents: $(100_000), ratePct: 6, termMonths: 24, repayment: "interest_only", rateChanges: [{ fromMonth: 13, ratePct: 8 }] });
    if (s.status !== "complete") throw new Error("expected complete");
    expect(s.rows[11].paymentCents).toBe($(500));
    expect(s.rows[12].paymentCents).toBe(66_667);
  });
});

describe("AT13 incomplete inputs", () => {
  it("missing rent, rates or costs return incomplete", () => {
    const i = fixtureInputs();
    i.rent = { weeklyCents: null, vacantWeeks: 2 };
    i.operatingCosts = [{ label: "Council rates", amountCents: null }];
    i.purchaseLoan.ratePct = null;
    const r = calculateScenario(i);
    expect(r.cashflow.status).toBe("incomplete");
    expect(r.cashflow.missing).toEqual(expect.arrayContaining(["rent.weeklyCents", "purchaseLoan.ratePct", "operatingCosts[0] Council rates"]));
    expect(r.cashflow.annualIncrementalCashflowCents).toBeNull();
  });
  it("unknown purchase costs never become zero", () => {
    const i = fixtureInputs();
    i.purchaseCosts = [{ label: "Stamp duty", amountCents: null }];
    const r = calculateScenario(i);
    expect(r.funding.cashRequiredCents).toBeNull();
    expect(r.funding.status).toBe("incomplete");
  });
  it("zero price cannot create an infinite yield", () => {
    const i = fixtureInputs();
    i.purchasePriceCents = 0;
    const r = calculateScenario(i);
    expect(r.cashflow.grossRentalYieldPct).toBeNull();
  });
  it("vacant weeks and vacancy percentage together are invalid", () => {
    const i = fixtureInputs();
    i.rent = { weeklyCents: $(750), vacantWeeks: 2, vacancyPct: 4 };
    expect(calculateScenario(i).cashflow.status).toBe("invalid");
  });
});

describe("AT05 PPOR suppresses rental returns", () => {
  it("no rental income or yields are fabricated for PPOR", () => {
    const i = { ...fixtureInputs(), purpose: "ppor" as const };
    const r = calculateScenario(i);
    expect(r.cashflow.scheduledAnnualRentCents).toBeNull();
    expect(r.cashflow.grossRentalYieldPct).toBeNull();
    expect(r.cashflow.annualOwnershipCostCents).toBe($(49_400 + 7_500));
  });
});

describe("AT06 natural-language rate changes", () => {
  it("two percentage points is an absolute change", () => {
    const p = parseWhatIf("What happens if interest rises by two percentage points?");
    expect(p.changes).toEqual([{ op: "rate_add_pp", pp: 2 }]);
    expect(applyChanges(fixtureInputs(), p.changes).purchaseLoan.ratePct).toBe(8.5);
  });
  it("two percent relative is a relative change", () => {
    const p = parseWhatIf("what if rates rise 2% relative");
    expect(p.changes).toEqual([{ op: "rate_scale_relative_pct", pct: 2 }]);
    expect(applyChanges(fixtureInputs(), p.changes).purchaseLoan.ratePct).toBe(6.63);
  });
  it("a bare percent is ambiguous and asks for clarification", () => {
    const p = parseWhatIf("what if interest goes up 2%");
    expect(p.changes).toHaveLength(0);
    expect(p.clarifications).toHaveLength(1);
  });
  it("price what-if", () => {
    const p = parseWhatIf("What if the price is $750,000?");
    expect(p.changes).toEqual([{ op: "set_price", cents: $(750_000), alsoValuation: true }]);
  });
});

describe("AT07 scenario changes do not mutate the base", () => {
  it("applyChanges returns a new object", () => {
    const base = fixtureInputs();
    const snapshot = JSON.stringify(base);
    applyChanges(base, [{ op: "rate_add_pp", pp: 2 }, { op: "set_price", cents: 1, alsoValuation: true }]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
  it("comparison reports deltas", () => {
    const d = compareResults(calculateScenario(fixtureInputs()), calculateScenario(downside()));
    const cf = d.find((x) => x.key === "annualCashflow")!;
    expect(cf.delta).toBe($(-20_300));
    expect(cf.direction).toBe("worse");
  });
});
