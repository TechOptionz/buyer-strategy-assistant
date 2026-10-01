import { D, toCents } from "./decimal";
import { evaluateSources } from "./calculate";
import type { ScenarioInputs } from "./types";

export interface CeilingParams {
  minPriceCents: number;
  maxPriceCents: number;
  /** Search precision; the result is rounded down to this. */
  stepCents: number;
  /** Lender valuation as a percentage of price (100 = valuation equals price). Explicit assumption. */
  valuationPctOfPrice: number | null;
  /** LVR cap applied to the new purchase loan. */
  purchaseLvrCapPct: number | null;
  /** Fixed upfront costs plus a percentage-of-price component (e.g. duty approximation entered by the agent). */
  fixedCostsCents: number | null;
  costsPctOfPrice: number | null;
}

export type CeilingResult =
  | { status: "incomplete"; missing: string[] }
  | { status: "invalid"; errors: string[] }
  | { status: "no_feasible_scenario"; testedFromCents: number; testedToCents: number; reason: string }
  | {
      status: "feasible";
      priceCents: number;
      loanCents: number;
      cashRequiredCents: number;
      availableFundingCents: number;
      bindingConstraint: "available_funding_with_lvr_cap" | "available_funding_with_borrowing_limit" | "search_maximum";
      assumptions: string[];
    };

/**
 * Highest tested price feasible against funding, reserve, costs, valuation basis, LVR cap and the
 * applicable borrowing limit (spec 9.2). This is a funding ceiling — NOT a maximum approved budget.
 */
export function fundingCeiling(inputs: ScenarioInputs, p: CeilingParams): CeilingResult {
  const missing: string[] = [];
  if (p.valuationPctOfPrice == null) missing.push("valuationPctOfPrice");
  if (p.purchaseLvrCapPct == null) missing.push("purchaseLvrCapPct");
  if (p.fixedCostsCents == null) missing.push("fixedCostsCents");
  if (p.costsPctOfPrice == null) missing.push("costsPctOfPrice");
  if (inputs.protectedReserveCents == null) missing.push("protectedReserveCents");
  if (inputs.otherEarmarkedCents == null) missing.push("otherEarmarkedCents");
  const lim = inputs.borrowingLimit;
  if (!lim || lim.amountCents == null) missing.push("borrowingLimit.amountCents");
  if (lim && lim.scope === "unknown") missing.push("borrowingLimit.scope");
  if (inputs.equityDraw && (inputs.equityDraw.principalCents == null || inputs.equityDraw.allocatedCents == null))
    missing.push("equityDraw");
  const src = evaluateSources(inputs);
  missing.push(...src.missing);
  if (missing.length) return { status: "incomplete", missing };
  if (src.errors.length) return { status: "invalid", errors: src.errors };
  if (p.stepCents <= 0 || p.minPriceCents < 0 || p.maxPriceCents < p.minPriceCents)
    return { status: "invalid", errors: ["Search range or precision is invalid"] };
  if ((p.maxPriceCents - p.minPriceCents) / p.stepCents > 200_000)
    return { status: "invalid", errors: ["Search range is too wide for the chosen precision"] };

  const available = src.committed
    .minus(inputs.protectedReserveCents!)
    .minus(inputs.otherEarmarkedCents!)
    .plus(src.sale)
    .plus(inputs.equityDraw?.allocatedCents ?? 0);
  const limitForPurchase = new D(lim!.amountCents!).minus(
    lim!.scope === "includes_equity_draw" ? (inputs.equityDraw?.principalCents ?? 0) : 0,
  );

  const evaluate = (price: number) => {
    const valuation = new D(price).mul(p.valuationPctOfPrice!).div(100);
    const lvrLoan = valuation.mul(p.purchaseLvrCapPct!).div(100);
    const loan = D.max(0, D.min(lvrLoan, limitForPurchase)).floor();
    const costs = new D(p.fixedCostsCents!).plus(new D(price).mul(p.costsPctOfPrice!).div(100));
    const cashRequired = new D(price).plus(costs).minus(loan);
    return { loan, cashRequired, limitBinds: limitForPurchase.lt(lvrLoan), ok: cashRequired.lte(available) };
  };

  // Rounded down to the search precision: scan downward from the top of the grid.
  const startIndex = Math.floor((p.maxPriceCents - p.minPriceCents) / p.stepCents);
  for (let i = startIndex; i >= 0; i--) {
    const price = p.minPriceCents + i * p.stepCents;
    const e = evaluate(price);
    if (e.ok) {
      const assumptions = [
        `Valuation assumed at ${p.valuationPctOfPrice}% of price`,
        `New loan capped at ${p.purchaseLvrCapPct}% LVR`,
        `Upfront costs: fixed ${(p.fixedCostsCents! / 100).toFixed(2)} plus ${p.costsPctOfPrice}% of price`,
        `Borrowing limit scope: ${lim!.scope.replaceAll("_", " ")}${lim!.confirmed ? "" : " (not confirmed)"}`,
        "Protected reserve is excluded from funding",
        "Funding ceiling is not loan approval and does not establish serviceability",
      ];
      let binding: "available_funding_with_lvr_cap" | "available_funding_with_borrowing_limit" | "search_maximum" =
        "search_maximum";
      if (i < startIndex) {
        const next = evaluate(price + p.stepCents);
        binding = next.limitBinds ? "available_funding_with_borrowing_limit" : "available_funding_with_lvr_cap";
      }
      return {
        status: "feasible",
        priceCents: price,
        loanCents: toCents(e.loan),
        cashRequiredCents: toCents(e.cashRequired),
        availableFundingCents: toCents(available),
        bindingConstraint: binding,
        assumptions,
      };
    }
  }
  return {
    status: "no_feasible_scenario",
    testedFromCents: p.minPriceCents,
    testedToCents: p.maxPriceCents,
    reason: "Available funding does not cover the cash required at any tested price",
  };
}
