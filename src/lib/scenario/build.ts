import type { ScenarioInputs } from "../finance/types";
import type { ProfileView } from "../profile/state";

export type AssumptionKind = "confirmed" | "assumed" | "missing";

export interface BuiltScenario {
  inputs: ScenarioInputs;
  /** Label for each input: whether it came from a confirmed fact, an explicit assumption, or is missing. */
  labels: Record<string, string>;
  kinds: Record<string, AssumptionKind>;
}

/**
 * Build explicit calculation inputs from the confirmed profile. Every derived value is labelled as an
 * assumption so it is visible and editable (ANA01, 9.5). Unknown values stay null — never zero.
 */
export function buildFromProfile(view: ProfileView, opts: { purpose?: "investment" | "ppor" } = {}): BuiltScenario {
  const labels: Record<string, string> = {};
  const kinds: Record<string, AssumptionKind> = {};
  const mark = (key: string, kind: AssumptionKind, label: string) => {
    kinds[key] = kind;
    labels[key] = label;
  };
  const g = <T>(path: string) => view.get<T>(path) ?? null;
  const confirmedOrMissing = (key: string, path: string, what: string) =>
    view.known(path) ? mark(key, "confirmed", `${what} (confirmed)`) : mark(key, "missing", `${what} not confirmed`);

  const profilePurpose = g<string>("goals.purchasePurpose");
  const purpose = opts.purpose ?? (profilePurpose === "investment" || profilePurpose === "ppor" ? profilePurpose : null);
  if (opts.purpose && profilePurpose === "undecided") mark("purpose", "assumed", `Modelled as ${opts.purpose} path (buyer undecided)`);
  else confirmedOrMissing("purpose", "goals.purchasePurpose", "Purchase purpose");

  const price = g<number>("scenario.targetPrice");
  confirmedOrMissing("purchasePriceCents", "scenario.targetPrice", "Purchase price");
  const valuation = price;
  if (price != null) mark("lenderValuationCents", "assumed", "Lender valuation assumed equal to purchase price");
  else mark("lenderValuationCents", "missing", "Valuation unavailable until a price is set");

  const lvr = g<number>("finance.lvrCapPct");
  let loan = g<number>("scenario.purchaseLoanAmount");
  if (loan != null) mark("purchaseLoan.principalCents", "confirmed", "Planned purchase loan (confirmed)");
  else if (price != null && lvr != null) {
    loan = Math.floor((price * lvr) / 100);
    mark("purchaseLoan.principalCents", "assumed", `Purchase loan assumed at ${lvr}% of valuation`);
  } else mark("purchaseLoan.principalCents", "missing", "Purchase loan needs a price and LVR assumption");

  const rate = g<number>("finance.interestRatePct");
  const termYears = g<number>("finance.loanTermYears");
  const repayment = g<"interest_only" | "principal_and_interest">("finance.repaymentType");
  confirmedOrMissing("purchaseLoan.ratePct", "finance.interestRatePct", "Interest rate");
  confirmedOrMissing("purchaseLoan.termMonths", "finance.loanTermYears", "Loan term");
  confirmedOrMissing("purchaseLoan.repayment", "finance.repaymentType", "Repayment type");

  const costs = g<number>("scenario.purchaseCosts");
  confirmedOrMissing("purchaseCosts", "scenario.purchaseCosts", "Upfront purchase costs");

  // Existing property used as security (the first property being kept).
  const props = view.propertyIndexes();
  const securityIdx = props.find((i) => view.get(`properties.${i}.intention`) !== "sell") ?? props[0];
  const equityPlanned = g<boolean>("funding.equityDrawRequested") === true;
  let securityResolved: boolean | undefined;
  if (securityIdx != null) {
    const structure = g<string>(`properties.${securityIdx}.ownershipStructure`);
    if (structure === "tenants_in_common" || structure === "company_trust")
      securityResolved = g<boolean>(`properties.${securityIdx}.securityArrangementResolved`) === true;
  }
  const equityAmount = g<number>("finance.equityDrawAmount");
  if (equityPlanned) {
    confirmedOrMissing("equityDraw.principalCents", "finance.equityDrawAmount", "Equity release amount");
    if (equityAmount != null) mark("equityDraw.allocatedCents", "assumed", "Equity release assumed fully allocated to settlement");
  }

  const fundingSources: ScenarioInputs["fundingSources"] = [];
  if (view.answered("funds.cash")) fundingSources.push({ id: "cash", label: "Cash savings", kind: "cash", amountCents: g("funds.cash"), linkedTo: "cash-accounts" });
  if (view.known("funds.offset")) fundingSources.push({ id: "offset", label: "Offset balances", kind: "offset", amountCents: g("funds.offset"), linkedTo: "offset-accounts" });
  const selling = props.some((i) => view.get(`properties.${i}.intention`) === "sell");
  if (selling && view.answered("funds.saleProceedsNet"))
    fundingSources.push({
      id: "sale",
      label: "Net sale proceeds",
      kind: "sale_proceeds",
      amountCents: g("funds.saleProceedsNet"),
      netOfDebtAndCosts: true,
      availableBeforeSettlement: g<boolean>("funds.saleProceedsBeforeSettlement"),
      linkedTo: "sale-proceeds",
    });
  if (view.known("super.balance")) fundingSources.push({ id: "super", label: "Superannuation", kind: "super", amountCents: g("super.balance") });
  confirmedOrMissing("fundingSources", "funds.cash", "Cash savings");

  const scope = g<string>("finance.limitScope");
  const status = g<string>("finance.confirmationStatus");
  const limit = g<number>("finance.borrowingLimit");

  const rent = g<number>("scenario.expectedWeeklyRent");
  const vacant = g<number>("scenario.vacantWeeks");
  const opCosts = g<number>("scenario.annualOperatingCosts");
  if (purpose === "investment") {
    confirmedOrMissing("rent.weeklyCents", "scenario.expectedWeeklyRent", "Weekly rent");
    confirmedOrMissing("rent.vacantWeeks", "scenario.vacantWeeks", "Vacant weeks");
  }
  confirmedOrMissing("operatingCosts", "scenario.annualOperatingCosts", purpose === "ppor" ? "Annual ownership costs" : "Annual operating costs");

  const loanTerm = termYears != null ? Math.round(termYears * 12) : null;
  const inputs: ScenarioInputs = {
    purpose,
    purchasePriceCents: price,
    lenderValuationCents: valuation,
    purchaseCosts: [{ label: "Upfront purchase costs", amountCents: costs, basis: "manual" }],
    purchaseLoan: { principalCents: loan, ratePct: rate, termMonths: loanTerm, repayment },
    purchaseLvrCapPct: lvr,
    equityDraw: equityPlanned
      ? { principalCents: equityAmount, allocatedCents: equityAmount, ratePct: rate, termMonths: loanTerm, repayment, securityArrangementResolved: securityResolved }
      : null,
    fundingSources,
    protectedReserveCents: g("funds.protectedReserve"),
    otherEarmarkedCents: g("funds.earmarked"),
    existingSecurity:
      securityIdx != null
        ? { propertyValueCents: g(`properties.${securityIdx}.value`), securedDebtCents: g(`properties.${securityIdx}.debt`), assumedLvrCapPct: lvr }
        : null,
    borrowingLimit: limit != null ? { amountCents: limit, scope: scope === "includes_equity_draw" || scope === "purchase_loan_only" ? scope : equityPlanned ? "unknown" : "purchase_loan_only", confirmed: status === "pre_approval" || status === "formal_approval" } : null,
    rent: purpose === "investment" ? { weeklyCents: rent, vacantWeeks: vacant } : null,
    operatingCosts: [{ label: purpose === "ppor" ? "Annual ownership costs" : "Annual operating costs", amountCents: opCosts }],
    financeConfirmed: status === "formal_approval" || status === "pre_approval",
  };
  if (!equityPlanned && limit != null && !scope) mark("borrowingLimit.scope", "assumed", "No equity release, so the limit is treated as covering the purchase loan only");
  if (status !== "formal_approval" && status !== "pre_approval") mark("financeConfirmed", "missing", "Finance not confirmed by pre-approval or approval");
  else mark("financeConfirmed", "confirmed", status === "formal_approval" ? "Formal approval recorded" : "Pre-approval recorded");
  return { inputs, labels, kinds };
}
