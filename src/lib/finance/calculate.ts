import { D, type Dec, pct, toCents } from "./decimal";
import { buildSchedule } from "./loan";
import {
  CALCULATION_VERSION,
  type CashflowResult,
  type Check,
  type FundingResult,
  type ScenarioInputs,
  type ScenarioResult,
} from "./types";

const c = (v: number) => new D(v);

function emptyFunding(): FundingResult {
  return {
    status: "incomplete",
    missing: [],
    errors: [],
    currentEquityCents: null,
    theoreticalHeadroomCents: null,
    committedCashCents: null,
    usableCashCents: null,
    eligibleSaleProceedsCents: null,
    equityDrawAllocatedCents: null,
    equityDrawUnallocatedCents: null,
    availableFundingCents: null,
    upfrontCostsCents: null,
    cashRequiredCents: null,
    fundingSurplusCents: null,
    cashRemainingIncludingReserveCents: null,
    newPropertyLvrPct: null,
    incrementalBorrowingCents: null,
    conditionalFunding: false,
    excludedSources: [],
  };
}

/** Upfront costs: every item must be known. Unknown costs never become zero (rule 7). */
export function sumCosts(items: ScenarioInputs["purchaseCosts"], prefix: string, priceCents?: number | null) {
  const missing: string[] = [];
  let total = new D(0);
  items.forEach((item, i) => {
    if (item.amountCents != null) total = total.plus(item.amountCents);
    else if (item.pctOfPrice != null && priceCents != null) total = total.plus(c(priceCents).mul(item.pctOfPrice).div(100));
    else missing.push(`${prefix}[${i}] ${item.label}`);
  });
  return { total, missing };
}

/**
 * Funding sources: validates one-use-per-source and excludes items that cannot be ordinary
 * purchase funding (super, loan proceeds supplied as "cash") — rules 4, 5 and 6.
 */
export function evaluateSources(inputs: ScenarioInputs) {
  const errors: string[] = [];
  const missing: string[] = [];
  const excluded: { id: string; reason: string }[] = [];
  let committed = new D(0);
  let sale = new D(0);
  let conditional = false;
  const seenIds = new Set<string>();
  const seenLinks = new Map<string, string>();

  for (const s of inputs.fundingSources) {
    if (seenIds.has(s.id)) {
      errors.push(`Funding source "${s.label}" is listed more than once`);
      continue;
    }
    seenIds.add(s.id);
    if (s.linkedTo) {
      const prior = seenLinks.get(s.linkedTo);
      if (prior) {
        errors.push(`"${s.label}" and "${prior}" draw on the same asset or loan (${s.linkedTo}); a source can be consumed only once`);
        continue;
      }
      seenLinks.set(s.linkedTo, s.label);
    }
    if (s.kind === "super") {
      excluded.push({ id: s.id, reason: "Superannuation is outside ordinary purchase funding and needs separately scoped treatment" });
      continue;
    }
    if (s.kind === "loan_proceeds") {
      excluded.push({ id: s.id, reason: "Loan proceeds must be modelled as a loan (purchase loan or equity draw), not as cash" });
      continue;
    }
    if (s.amountCents == null) {
      missing.push(`fundingSources.${s.id}.amountCents`);
      continue;
    }
    if (s.amountCents < 0) {
      errors.push(`Funding source "${s.label}" cannot be negative`);
      continue;
    }
    if (s.kind === "sale_proceeds") {
      if (s.netOfDebtAndCosts !== true) {
        missing.push(`fundingSources.${s.id}.netOfDebtAndCosts`);
        continue;
      }
      if (s.availableBeforeSettlement !== true) conditional = true;
      sale = sale.plus(s.amountCents);
    } else {
      committed = committed.plus(s.amountCents);
    }
  }
  return { committed, sale, conditional, errors, missing, excluded };
}

export function calculateFunding(inputs: ScenarioInputs): FundingResult {
  const r = emptyFunding();
  const missing: string[] = [];

  // Existing security: equity can be negative, headroom cannot.
  const sec = inputs.existingSecurity;
  if (sec) {
    if (sec.propertyValueCents != null && sec.securedDebtCents != null)
      r.currentEquityCents = sec.propertyValueCents - sec.securedDebtCents;
    if (sec.propertyValueCents != null && sec.securedDebtCents != null && sec.assumedLvrCapPct != null) {
      const head = c(sec.propertyValueCents).mul(sec.assumedLvrCapPct).div(100).minus(sec.securedDebtCents);
      r.theoreticalHeadroomCents = toCents(D.max(0, head));
    }
  }

  const src = evaluateSources(inputs);
  r.errors.push(...src.errors);
  missing.push(...src.missing);
  r.excludedSources = src.excluded;
  r.conditionalFunding = src.conditional;
  r.committedCashCents = toCents(src.committed);
  r.eligibleSaleProceedsCents = toCents(src.sale);

  if (inputs.protectedReserveCents == null) missing.push("protectedReserveCents");
  if (inputs.otherEarmarkedCents == null) missing.push("otherEarmarkedCents");
  if (inputs.protectedReserveCents != null && inputs.otherEarmarkedCents != null) {
    r.usableCashCents = toCents(src.committed.minus(inputs.protectedReserveCents).minus(inputs.otherEarmarkedCents));
  }

  // Equity draw: drawn amount carries debt service; only the allocated part funds settlement.
  let allocated = new D(0);
  let drawn = new D(0);
  const eq = inputs.equityDraw;
  if (eq) {
    if (eq.principalCents == null) missing.push("equityDraw.principalCents");
    if (eq.allocatedCents == null) missing.push("equityDraw.allocatedCents");
    if (eq.principalCents != null && eq.allocatedCents != null) {
      if (eq.allocatedCents > eq.principalCents) r.errors.push("Equity draw allocated to settlement exceeds the amount drawn");
      allocated = c(eq.allocatedCents);
      drawn = c(eq.principalCents);
      r.equityDrawAllocatedCents = eq.allocatedCents;
      r.equityDrawUnallocatedCents = eq.principalCents - eq.allocatedCents;
    }
    if (eq.securityArrangementResolved === false)
      r.errors.push("Ownership/security arrangement for the equity draw is unresolved; confirmed equity funding is blocked");
  } else {
    r.equityDrawAllocatedCents = 0;
    r.equityDrawUnallocatedCents = 0;
  }

  if (r.usableCashCents != null && (!eq || (eq.principalCents != null && eq.allocatedCents != null))) {
    r.availableFundingCents = toCents(c(r.usableCashCents).plus(src.sale).plus(allocated));
  }

  // Cash required at settlement.
  if (inputs.purchasePriceCents == null) missing.push("purchasePriceCents");
  if (inputs.purchaseLoan.principalCents == null) missing.push("purchaseLoan.principalCents");
  const costs = sumCosts(inputs.purchaseCosts, "purchaseCosts", inputs.purchasePriceCents);
  if (inputs.purchaseCosts.length === 0) missing.push("purchaseCosts");
  missing.push(...costs.missing);
  if (costs.missing.length === 0 && inputs.purchaseCosts.length > 0) r.upfrontCostsCents = toCents(costs.total);

  if (inputs.purchasePriceCents != null && r.upfrontCostsCents != null && inputs.purchaseLoan.principalCents != null) {
    r.cashRequiredCents = inputs.purchasePriceCents + r.upfrontCostsCents - inputs.purchaseLoan.principalCents;
  }
  if (r.cashRequiredCents != null && r.availableFundingCents != null) {
    r.fundingSurplusCents = r.availableFundingCents - r.cashRequiredCents;
  }
  if (r.cashRequiredCents != null && inputs.otherEarmarkedCents != null && (!eq || eq.principalCents != null)) {
    // Liquid cash after settlement, including the protected reserve, excluding earmarked cash.
    r.cashRemainingIncludingReserveCents = toCents(
      src.committed.minus(inputs.otherEarmarkedCents).plus(src.sale).plus(drawn).minus(r.cashRequiredCents),
    );
  }

  if (inputs.lenderValuationCents == null) missing.push("lenderValuationCents");
  if (inputs.purchaseLoan.principalCents != null && inputs.lenderValuationCents != null) {
    r.newPropertyLvrPct = inputs.lenderValuationCents === 0
      ? null
      : pct(c(inputs.purchaseLoan.principalCents).div(inputs.lenderValuationCents).mul(100), 2);
  }
  if (inputs.purchaseLoan.principalCents != null && (!eq || eq.principalCents != null)) {
    r.incrementalBorrowingCents = inputs.purchaseLoan.principalCents + (eq?.principalCents ?? 0);
  }

  r.missing = [...new Set(missing)];
  r.status = r.errors.length ? "invalid" : r.missing.length ? "incomplete" : "complete";
  return r;
}

export function calculateCashflow(inputs: ScenarioInputs): CashflowResult {
  const r: CashflowResult = {
    status: "incomplete",
    missing: [],
    scheduledAnnualRentCents: null,
    collectedAnnualRentCents: null,
    annualOperatingCostsCents: null,
    netOperatingIncomeCents: null,
    grossRentalYieldPct: null,
    netRentalYieldPct: null,
    purchaseLoanAnnualDebtServiceCents: null,
    equityDrawAnnualDebtServiceCents: null,
    annualIncrementalDebtServiceCents: null,
    annualIncrementalCashflowCents: null,
    averageMonthlyCashflowCents: null,
    annualOwnershipCostCents: null,
  };
  const missing: string[] = [];
  const errors: string[] = [];

  // Debt service: purchase loan plus the full equity amount actually drawn.
  const purchase = buildSchedule(inputs.purchaseLoan, "purchaseLoan");
  if (purchase.status === "incomplete") missing.push(...purchase.missing);
  if (purchase.status === "invalid") errors.push(...purchase.errors);
  let debt: Dec | null = null;
  if (purchase.status === "complete") {
    r.purchaseLoanAnnualDebtServiceCents = purchase.firstYearPaymentsCents;
    debt = c(purchase.firstYearPaymentsCents);
  }
  if (inputs.equityDraw) {
    const eq = buildSchedule(inputs.equityDraw, "equityDraw");
    if (eq.status === "incomplete") missing.push(...eq.missing);
    if (eq.status === "invalid") errors.push(...eq.errors);
    if (eq.status === "complete") {
      r.equityDrawAnnualDebtServiceCents = eq.firstYearPaymentsCents;
      debt = debt ? debt.plus(eq.firstYearPaymentsCents) : null;
    } else debt = null;
  } else {
    r.equityDrawAnnualDebtServiceCents = 0;
  }
  if (debt) r.annualIncrementalDebtServiceCents = toCents(debt);

  // Operating / ownership costs.
  if (inputs.operatingCosts == null) missing.push("operatingCosts");
  else {
    const oc = sumCosts(inputs.operatingCosts, "operatingCosts", inputs.purchasePriceCents);
    missing.push(...oc.missing);
    if (oc.missing.length === 0) r.annualOperatingCostsCents = toCents(oc.total);
  }

  const rental = inputs.purpose === "investment" || (inputs.purpose === "ppor" && inputs.modelRentalComponent);
  if (inputs.purpose == null) missing.push("purpose");

  if (inputs.purpose === "ppor" && !inputs.modelRentalComponent) {
    // PPOR: rental returns are suppressed; show ownership cost instead (spec 9.5, AT05).
    if (r.annualIncrementalDebtServiceCents != null && r.annualOperatingCostsCents != null)
      r.annualOwnershipCostCents = r.annualIncrementalDebtServiceCents + r.annualOperatingCostsCents;
    r.missing = [...new Set(missing)];
    r.status = errors.length ? "invalid" : r.missing.length ? "incomplete" : "complete";
    return r;
  }

  if (rental) {
    const rent = inputs.rent;
    if (!rent || rent.weeklyCents == null) missing.push("rent.weeklyCents");
    const hasWeeks = rent?.vacantWeeks != null;
    const hasPct = rent?.vacancyPct != null;
    if (rent && hasWeeks && hasPct) errors.push("Use either vacant weeks or a vacancy percentage, not both");
    if (!hasWeeks && !hasPct) missing.push("rent.vacancyBasis");
    if (rent?.vacantWeeks != null && (rent.vacantWeeks < 0 || rent.vacantWeeks > 52)) errors.push("Vacant weeks must be between 0 and 52");
    if (rent?.vacancyPct != null && (rent.vacancyPct < 0 || rent.vacancyPct > 100)) errors.push("Vacancy percentage must be between 0 and 100");

    if (rent?.weeklyCents != null) {
      const scheduled = c(rent.weeklyCents).mul(52);
      r.scheduledAnnualRentCents = toCents(scheduled);
      let collected: Dec | null = null;
      if (hasWeeks && !hasPct) collected = c(rent.weeklyCents).mul(new D(52).minus(rent.vacantWeeks!));
      if (hasPct && !hasWeeks) collected = scheduled.mul(new D(100).minus(rent.vacancyPct!)).div(100);
      if (collected) {
        r.collectedAnnualRentCents = toCents(collected);
        if (r.annualOperatingCostsCents != null) {
          const noi = collected.minus(r.annualOperatingCostsCents);
          r.netOperatingIncomeCents = toCents(noi);
          const price = inputs.purchasePriceCents;
          // Zero price never yields an infinite yield: not applicable.
          if (price != null && price > 0) {
            r.grossRentalYieldPct = pct(scheduled.div(price).mul(100));
            r.netRentalYieldPct = pct(noi.div(price).mul(100));
          }
          if (debt) {
            const cf = noi.minus(debt);
            r.annualIncrementalCashflowCents = toCents(cf);
            r.averageMonthlyCashflowCents = toCents(cf.div(12));
          }
        }
      }
    }
    if (inputs.purchasePriceCents == null) missing.push("purchasePriceCents");
  }

  r.missing = [...new Set(missing)];
  r.status = errors.length ? "invalid" : r.missing.length ? "incomplete" : "complete";
  if (errors.length) r.missing.push(...errors.map((e) => `error: ${e}`));
  return r;
}

function buildChecks(inputs: ScenarioInputs, f: FundingResult): Check[] {
  const checks: Check[] = [];
  if (f.cashRequiredCents != null && f.availableFundingCents != null) {
    const ok = f.cashRequiredCents <= f.availableFundingCents;
    checks.push({
      key: "funding",
      label: "Cash required is covered by available funding (excluding protected reserve)",
      outcome: ok ? (f.conditionalFunding ? "warning" : "pass") : "fail",
      detail: f.conditionalFunding ? "Relies on sale proceeds not confirmed as available before settlement (conditional funding)." : "",
    });
  } else checks.push({ key: "funding", label: "Funding test", outcome: "unresolved", detail: "Inputs incomplete" });

  const lim = inputs.borrowingLimit;
  if (!lim || lim.amountCents == null) {
    checks.push({ key: "borrowing_limit", label: "Borrowing limit", outcome: "unresolved", detail: "No borrowing limit entered" });
  } else if (lim.scope === "unknown") {
    checks.push({
      key: "borrowing_limit",
      label: "Borrowing limit",
      outcome: "unresolved",
      detail: "Borrowing-limit scope unknown: does it include the equity draw or only the purchase loan?",
    });
  } else {
    const used =
      (inputs.purchaseLoan.principalCents ?? 0) + (lim.scope === "includes_equity_draw" ? (inputs.equityDraw?.principalCents ?? 0) : 0);
    checks.push({
      key: "borrowing_limit",
      label: lim.scope === "includes_equity_draw" ? "Purchase loan plus equity draw within borrowing limit" : "Purchase loan within borrowing limit",
      outcome: used <= lim.amountCents ? (lim.confirmed ? "pass" : "warning") : "fail",
      detail: lim.confirmed ? "" : "Borrowing limit is not externally confirmed.",
    });
  }

  if (inputs.equityDraw?.principalCents != null) {
    if (f.theoreticalHeadroomCents == null)
      checks.push({ key: "equity_headroom", label: "Equity draw within theoretical headroom", outcome: "unresolved", detail: "Existing property value, debt or LVR cap missing" });
    else
      checks.push({
        key: "equity_headroom",
        label: "Equity draw within theoretical headroom",
        outcome: inputs.equityDraw.principalCents <= f.theoreticalHeadroomCents ? "pass" : "fail",
        detail: "Headroom is theoretical security capacity, not an approved limit.",
      });
  }

  if (inputs.purchaseLvrCapPct != null && f.newPropertyLvrPct != null) {
    checks.push({
      key: "new_lvr",
      label: `New property LVR at or below ${inputs.purchaseLvrCapPct}%`,
      outcome: Number(f.newPropertyLvrPct) <= inputs.purchaseLvrCapPct ? "pass" : "fail",
      detail: "",
    });
  }

  for (const ex of f.excludedSources) checks.push({ key: `excluded_${ex.id}`, label: "Funding source excluded", outcome: "warning", detail: ex.reason });

  checks.push({
    key: "serviceability",
    label: "Serviceability / finance confirmation",
    outcome: inputs.financeConfirmed ? "pass" : "unresolved",
    detail: inputs.financeConfirmed
      ? "Finance assessment recorded as confirmed by the agent."
      : "Available cash and headroom do not establish serviceability. Finance is not confirmed.",
  });
  return checks;
}

export function calculateScenario(inputs: ScenarioInputs): ScenarioResult {
  const funding = calculateFunding(inputs);
  const cashflow = calculateCashflow(inputs);
  const notes = ["Indicative scenario only; not a lender's assessment or loan approval.", "Personal tax effects are excluded."];
  if (cashflow.averageMonthlyCashflowCents != null)
    notes.push("Average monthly cashflow is annual cashflow divided by 12, not a dated monthly forecast.");
  return {
    calculationVersion: CALCULATION_VERSION,
    funding,
    cashflow,
    checks: buildChecks(inputs, funding),
    financeConfirmed: inputs.financeConfirmed,
    notes,
  };
}
