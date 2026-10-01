import { patternOf } from "./fields";

/** Period suffixes for money flows. Every flow shows its period (design number rules). */
export const PERIOD_UNIT: Record<string, string> = { weekly: "/wk", fortnightly: "/fn", monthly: "/mo", annual: "/yr" };

/** Fixed units by field pattern. Income and expenses take their period from the paired frequency field. */
export const UNIT_BY_PATTERN: Record<string, string> = {
  "properties.*.rentWeekly": "/wk",
  "scenario.expectedWeeklyRent": "/wk",
  "properties.*.annualCosts": "/yr",
  "scenario.annualOperatingCosts": "/yr",
  "properties.*.loanRepaymentMonthly": "/mo",
  "household.currentLoanRepaymentsMonthly": "/mo",
  "household.otherCommitmentsMonthly": "/mo",
  "goals.comfortableMonthlyContribution": "/mo",
  "goals.holdingPeriodYears": " yrs",
  "finance.loanTermYears": " yrs",
  "scenario.forecastHorizonYears": " yrs",
  "scenario.vacantWeeks": " wks/yr",
};

/** Unit for a field, given a way to read the paired frequency field. */
export function unitOf(path: string, frequencyOf: (path: string) => string | undefined): string {
  if (path === "household.income.amount") return PERIOD_UNIT[frequencyOf("household.income.frequency") ?? ""] ?? "";
  if (path === "household.expenses.amount") return PERIOD_UNIT[frequencyOf("household.expenses.frequency") ?? ""] ?? "";
  return UNIT_BY_PATTERN[patternOf(path)] ?? "";
}
