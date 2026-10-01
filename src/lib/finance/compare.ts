import type { ScenarioResult } from "./types";

export interface MetricDef {
  key: string;
  label: string;
  kind: "money" | "pct";
  get: (r: ScenarioResult) => number | string | null;
  /** Whether higher is better for the buyer, used to phrase benefits vs trade-offs. */
  higherIsBetter: boolean;
}

export const METRICS: MetricDef[] = [
  { key: "cashRequired", label: "Cash required at settlement", kind: "money", get: (r) => r.funding.cashRequiredCents, higherIsBetter: false },
  { key: "availableFunding", label: "Funding available (excl. reserve)", kind: "money", get: (r) => r.funding.availableFundingCents, higherIsBetter: true },
  { key: "fundingSurplus", label: "Funding surplus / (shortfall)", kind: "money", get: (r) => r.funding.fundingSurplusCents, higherIsBetter: true },
  { key: "cashRemaining", label: "Cash remaining incl. reserve", kind: "money", get: (r) => r.funding.cashRemainingIncludingReserveCents, higherIsBetter: true },
  { key: "headroom", label: "Theoretical headroom", kind: "money", get: (r) => r.funding.theoreticalHeadroomCents, higherIsBetter: true },
  { key: "newLvr", label: "New property LVR", kind: "pct", get: (r) => r.funding.newPropertyLvrPct, higherIsBetter: false },
  { key: "grossRent", label: "Scheduled annual rent", kind: "money", get: (r) => r.cashflow.scheduledAnnualRentCents, higherIsBetter: true },
  { key: "collectedRent", label: "Collected annual rent", kind: "money", get: (r) => r.cashflow.collectedAnnualRentCents, higherIsBetter: true },
  { key: "noi", label: "Net operating income", kind: "money", get: (r) => r.cashflow.netOperatingIncomeCents, higherIsBetter: true },
  { key: "grossYield", label: "Gross rental yield", kind: "pct", get: (r) => r.cashflow.grossRentalYieldPct, higherIsBetter: true },
  { key: "netYield", label: "Net rental yield", kind: "pct", get: (r) => r.cashflow.netRentalYieldPct, higherIsBetter: true },
  { key: "debtService", label: "Annual incremental debt service", kind: "money", get: (r) => r.cashflow.annualIncrementalDebtServiceCents, higherIsBetter: false },
  { key: "annualCashflow", label: "Annual incremental cashflow", kind: "money", get: (r) => r.cashflow.annualIncrementalCashflowCents, higherIsBetter: true },
  { key: "monthlyCashflow", label: "Average monthly cashflow", kind: "money", get: (r) => r.cashflow.averageMonthlyCashflowCents, higherIsBetter: true },
  { key: "ownershipCost", label: "Annual ownership cost (PPOR)", kind: "money", get: (r) => r.cashflow.annualOwnershipCostCents, higherIsBetter: false },
];

export interface MetricDelta {
  key: string;
  label: string;
  kind: "money" | "pct";
  base: number | string | null;
  other: number | string | null;
  /** cents for money, percentage points (string) for pct; null if either side is unavailable. */
  delta: number | string | null;
  direction: "better" | "worse" | "same" | "unknown";
}

export function compareResults(base: ScenarioResult, other: ScenarioResult): MetricDelta[] {
  return METRICS.map((m) => {
    const a = m.get(base);
    const b = m.get(other);
    if (a == null || b == null) return { key: m.key, label: m.label, kind: m.kind, base: a, other: b, delta: null, direction: "unknown" as const };
    const delta = m.kind === "money" ? (b as number) - (a as number) : (Number(b) - Number(a)).toFixed(4);
    const d = Number(delta);
    const direction: MetricDelta["direction"] = d === 0 ? "same" : (d > 0) === m.higherIsBetter ? "better" : "worse";
    return { key: m.key, label: m.label, kind: m.kind, base: a, other: b, delta, direction };
  }).filter((d) => d.base != null || d.other != null);
}

/** Plain-language explanation built only from calculated deltas (ANA03). */
export function explainDeltas(deltas: MetricDelta[]): { benefits: string[]; tradeOffs: string[] } {
  const fmt = (d: MetricDelta) => {
    if (d.kind === "money") {
      const v = Math.abs(d.delta as number) / 100;
      return `$${v.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;
    }
    return `${Math.abs(Number(d.delta)).toFixed(2)} percentage points`;
  };
  const benefits: string[] = [];
  const tradeOffs: string[] = [];
  for (const d of deltas) {
    if (d.direction === "better") benefits.push(`${d.label} ${Number(d.delta) > 0 ? "increases" : "decreases"} by ${fmt(d)}.`);
    if (d.direction === "worse") tradeOffs.push(`${d.label} ${Number(d.delta) > 0 ? "increases" : "decreases"} by ${fmt(d)}.`);
  }
  return { benefits, tradeOffs };
}
