import { D, toCents } from "./decimal";
import type { ScenarioInputs } from "./types";

/**
 * A proposed scenario change. Patches never mutate the base scenario; applying one returns a new
 * input object that is calculated as a new, immutable scenario (ANA02, AT07).
 */
export type ScenarioChange =
  | { op: "set_price"; cents: number; alsoValuation: boolean }
  | { op: "set_valuation"; cents: number }
  | { op: "set_purchase_loan"; cents: number }
  | { op: "set_deposit"; cents: number }
  | { op: "set_equity_draw"; cents: number }
  | { op: "rate_add_pp"; pp: number }
  | { op: "rate_scale_relative_pct"; pct: number }
  | { op: "set_rate"; pct: number }
  | { op: "set_repayment"; repayment: "interest_only" | "principal_and_interest" }
  | { op: "set_weekly_rent"; cents: number }
  | { op: "rent_scale_relative_pct"; pct: number }
  | { op: "set_vacant_weeks"; weeks: number }
  | { op: "add_annual_cost"; label: string; cents: number }
  | { op: "valuation_scale_relative_pct"; pct: number };

export function describeChange(ch: ScenarioChange): string {
  const $ = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  switch (ch.op) {
    case "set_price":
      return `Purchase price → ${$(ch.cents)}${ch.alsoValuation ? " (valuation assumed equal)" : ""}`;
    case "set_valuation":
      return `Lender valuation → ${$(ch.cents)}`;
    case "set_purchase_loan":
      return `Purchase loan → ${$(ch.cents)}`;
    case "set_deposit":
      return `Deposit → ${$(ch.cents)} (purchase loan = price − deposit)`;
    case "set_equity_draw":
      return `Equity draw → ${$(ch.cents)} (fully allocated to settlement)`;
    case "rate_add_pp":
      return `Interest rates ${ch.pp >= 0 ? "+" : ""}${ch.pp} percentage points on all new loans`;
    case "rate_scale_relative_pct":
      return `Interest rates changed by ${ch.pct}% of their current value (relative change)`;
    case "set_rate":
      return `Interest rate → ${ch.pct}% on all new loans`;
    case "set_repayment":
      return `Repayment type → ${ch.repayment === "interest_only" ? "interest only" : "principal and interest"}`;
    case "set_weekly_rent":
      return `Weekly rent → ${$(ch.cents)}`;
    case "rent_scale_relative_pct":
      return `Weekly rent changed by ${ch.pct}%`;
    case "set_vacant_weeks":
      return `Vacancy → ${ch.weeks} weeks per year`;
    case "add_annual_cost":
      return `Additional annual cost "${ch.label}" ${$(ch.cents)}`;
    case "valuation_scale_relative_pct":
      return `Lender valuation changed by ${ch.pct}%`;
  }
}

const scaleCents = (cents: number, pct: number) => toCents(new D(cents).mul(new D(100).plus(pct)).div(100));
const round4 = (n: number) => new D(n).toDecimalPlaces(6).toNumber();

export function applyChanges(base: ScenarioInputs, changes: ScenarioChange[]): ScenarioInputs {
  const next: ScenarioInputs = structuredClone(base);
  const loans = () => [next.purchaseLoan, ...(next.equityDraw ? [next.equityDraw] : [])];
  for (const ch of changes) {
    switch (ch.op) {
      case "set_price":
        next.purchasePriceCents = ch.cents;
        if (ch.alsoValuation) next.lenderValuationCents = ch.cents;
        break;
      case "set_valuation":
        next.lenderValuationCents = ch.cents;
        break;
      case "set_purchase_loan":
        next.purchaseLoan.principalCents = ch.cents;
        break;
      case "set_deposit":
        if (next.purchasePriceCents != null) next.purchaseLoan.principalCents = next.purchasePriceCents - ch.cents;
        break;
      case "set_equity_draw":
        if (next.equityDraw) {
          next.equityDraw.principalCents = ch.cents;
          next.equityDraw.allocatedCents = ch.cents;
        }
        break;
      case "rate_add_pp":
        for (const l of loans()) {
          if (l.ratePct != null) l.ratePct = round4(l.ratePct + ch.pp);
          l.rateChanges = l.rateChanges?.map((r) => ({ ...r, ratePct: round4(r.ratePct + ch.pp) }));
        }
        break;
      case "rate_scale_relative_pct":
        for (const l of loans()) if (l.ratePct != null) l.ratePct = round4((l.ratePct * (100 + ch.pct)) / 100);
        break;
      case "set_rate":
        for (const l of loans()) l.ratePct = ch.pct;
        break;
      case "set_repayment":
        for (const l of loans()) {
          l.repayment = ch.repayment;
          if (ch.repayment === "principal_and_interest") l.interestOnlyMonths = 0;
          else l.interestOnlyMonths = null;
        }
        break;
      case "set_weekly_rent":
        next.rent = { ...(next.rent ?? { weeklyCents: null }), weeklyCents: ch.cents };
        break;
      case "rent_scale_relative_pct":
        if (next.rent?.weeklyCents != null) next.rent.weeklyCents = scaleCents(next.rent.weeklyCents, ch.pct);
        break;
      case "set_vacant_weeks":
        next.rent = { ...(next.rent ?? { weeklyCents: null }), vacantWeeks: ch.weeks, vacancyPct: null };
        break;
      case "add_annual_cost":
        next.operatingCosts = [...(next.operatingCosts ?? []), { label: ch.label, amountCents: ch.cents, basis: "assumed" }];
        break;
      case "valuation_scale_relative_pct":
        if (next.lenderValuationCents != null) next.lenderValuationCents = scaleCents(next.lenderValuationCents, ch.pct);
        break;
    }
  }
  return next;
}

/** Standard downside stress used when the agent asks for a downside case. */
export function downsideChanges(opts: { ratePp: number; rentPct: number; extraVacantWeeks: number; baseVacantWeeks: number | null }): ScenarioChange[] {
  const changes: ScenarioChange[] = [{ op: "rate_add_pp", pp: opts.ratePp }];
  if (opts.rentPct) changes.push({ op: "rent_scale_relative_pct", pct: opts.rentPct });
  if (opts.extraVacantWeeks && opts.baseVacantWeeks != null)
    changes.push({ op: "set_vacant_weeks", weeks: opts.baseVacantWeeks + opts.extraVacantWeeks });
  return changes;
}
