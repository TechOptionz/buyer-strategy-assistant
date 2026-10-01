export interface MetricDef {
  key: string;
  label: string;
  unit: "AUD" | "AUD/week" | "%" | "days" | "count";
  /** Default freshness threshold in days; organisations can override. */
  defaultFreshDays: number | null;
  help: string;
}

/** Metric catalogue. Each is a specific, labelled measure — never substitute one for another (Section 8). */
export const METRICS: MetricDef[] = [
  { key: "median_sale_price", label: "Median achieved sale price", unit: "AUD", defaultFreshDays: 120, help: "Achieved (settled) sales, not asking prices." },
  { key: "median_asking_price", label: "Median asking price", unit: "AUD", defaultFreshDays: 60, help: "Advertised prices. Not a substitute for achieved sales." },
  { key: "median_weekly_rent", label: "Median advertised weekly rent", unit: "AUD/week", defaultFreshDays: 90, help: "Advertised rents. Not a substitute for actual rent achieved." },
  { key: "gross_rental_yield", label: "Area gross rental yield", unit: "%", defaultFreshDays: 120, help: "Area-level; not an individual property cashflow." },
  { key: "vacancy_rate", label: "Rental vacancy rate", unit: "%", defaultFreshDays: 60, help: "Share of rental stock vacant." },
  { key: "days_on_market", label: "Median days on market", unit: "days", defaultFreshDays: 90, help: "Sales activity indicator." },
  { key: "sales_volume_12m", label: "Sales in last 12 months", unit: "count", defaultFreshDays: 120, help: "Sales activity indicator." },
  { key: "price_change_12m", label: "12-month median price change", unit: "%", defaultFreshDays: 120, help: "Historical context only — not a growth forecast." },
];

export const metricDef = (key: string) => METRICS.find((m) => m.key === key);

export const PROPERTY_TYPES = [
  { value: "house", label: "House" },
  { value: "unit", label: "Unit / apartment" },
  { value: "townhouse", label: "Townhouse" },
  { value: "all", label: "All dwellings" },
];

export function ageInDays(observedAtIso: string, now = new Date()) {
  return Math.floor((+now - +new Date(observedAtIso)) / 86_400_000);
}

export type Freshness = { state: "fresh" | "stale" | "age_only"; ageDays: number; thresholdDays: number | null };

/** With no configured threshold, show the age without claiming the metric is fresh. */
export function freshness(metric: string, observedAtIso: string, overrides: Record<string, number> = {}): Freshness {
  const ageDays = ageInDays(observedAtIso);
  const threshold = overrides[metric] ?? metricDef(metric)?.defaultFreshDays ?? null;
  if (threshold == null) return { state: "age_only", ageDays, thresholdDays: null };
  return { state: ageDays <= threshold ? "fresh" : "stale", ageDays, thresholdDays: threshold };
}

export function formatMetric(unit: string, value: string | number) {
  const n = Number(value);
  if (unit === "AUD") return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
  if (unit === "AUD/week") return `${n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 })}/wk`;
  if (unit === "%") return `${n}%`;
  if (unit === "days") return `${n} days`;
  return n.toLocaleString("en-AU");
}
