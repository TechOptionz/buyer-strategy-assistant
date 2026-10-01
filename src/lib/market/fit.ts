import type { ProfileView } from "../profile/state";
import { formatMetric, freshness } from "./metrics";

export type FitOutcome = "meets" | "partly_meets" | "does_not_meet" | "unknown";

export const FIT_LABELS: Record<FitOutcome, string> = {
  meets: "Meets",
  partly_meets: "Partly meets",
  does_not_meet: "Does not meet",
  unknown: "Unknown",
};

export interface EvidenceItem {
  id: string;
  area: string;
  propertyType: string;
  metric: string;
  valueNumeric: string;
  unit: string;
  periodEnd: string;
  sourceDescription: string;
  observedAt: string;
  provider: string;
  isSample: boolean;
}

export interface CriterionResult {
  key: string;
  label: string;
  /** Which confirmed buyer priority this criterion comes from. */
  basedOn: string;
  outcome: FitOutcome;
  reason: string;
  evidenceIds: string[];
  threshold?: string;
}

export interface AreaFit {
  area: string;
  excluded: boolean;
  exclusionReason?: string;
  criteria: CriterionResult[];
  missingEvidence: string[];
}

/** Rule thresholds are explicit, displayed with each result, and configurable — not hidden scores. */
export const DEFAULT_THRESHOLDS = {
  budgetPartlyPct: 10, // median up to 10% over budget → partly meets
  vacancyMeetsPct: 2,
  vacancyPartlyPct: 3,
  incomeYieldMeetsPct: 4.5,
  incomeYieldPartlyPct: 3.5,
};

function latest(evidence: EvidenceItem[], area: string, metric: string, propertyType: string) {
  const matches = evidence
    .filter((e) => e.area.toLowerCase() === area.toLowerCase() && e.metric === metric)
    .sort((a, b) => +new Date(b.periodEnd) - +new Date(a.periodEnd));
  const exact = matches.find((e) => e.propertyType === propertyType);
  return { item: exact ?? matches[0], mismatch: !exact && !!matches[0] };
}

/**
 * Explainable area fit (ANA04): each criterion links a confirmed buyer priority to specific dated
 * evidence and returns Meets / Partly meets / Does not meet / Unknown. Hard constraints first.
 */
export function assessAreas(view: ProfileView, areas: string[], evidence: EvidenceItem[], t = DEFAULT_THRESHOLDS): AreaFit[] {
  const excluded = (view.get<string[]>("preferences.excludedAreas") ?? []).map((a) => a.toLowerCase());
  const purpose = view.get<string>("goals.purchasePurpose");
  const propertyType = view.get<string>("preferences.propertyType");
  const typeKey = propertyType && propertyType !== "any" ? propertyType : "all";
  const budget = view.get<number>("preferences.budgetMax") ?? view.get<number>("scenario.targetPrice");
  const budgetSource = view.known("preferences.budgetMax") ? "Stated purchase budget" : "Target purchase price";
  const priority = view.get<string>("goals.incomeVsGrowth");

  return areas.map((area) => {
    const fit: AreaFit = { area, excluded: false, criteria: [], missingEvidence: [] };
    if (excluded.includes(area.toLowerCase())) {
      fit.excluded = true;
      fit.exclusionReason = "Listed by the buyer as an area to avoid (hard constraint).";
      return fit;
    }
    const mismatchNote = (m: boolean, e?: EvidenceItem) => (m && e ? ` Evidence is for "${e.propertyType}", not "${typeKey}" — like-for-like comparison not available.` : "");
    const evidenceNote = (e: EvidenceItem) => {
      const fr = freshness(e.metric, e.observedAt);
      const age = fr.state === "stale" ? ` STALE (${fr.ageDays} days old).` : fr.state === "age_only" ? ` ${fr.ageDays} days old.` : "";
      return ` Source: ${e.sourceDescription}, period to ${e.periodEnd}.${age}${e.isSample ? " SAMPLE DATA — not production evidence." : ""}`;
    };

    // 1. Budget vs achieved median sale price.
    {
      const { item, mismatch } = latest(evidence, area, "median_sale_price", typeKey);
      const c: CriterionResult = { key: "budget", label: "Typical price within budget", basedOn: budget != null ? budgetSource : "No budget or target price confirmed", outcome: "unknown", reason: "", evidenceIds: [], threshold: `Partly meets if median is up to ${t.budgetPartlyPct}% above budget` };
      if (budget == null) c.reason = "No confirmed budget or target price to compare against.";
      else if (!item) {
        c.reason = "No dated median sale price recorded for this area.";
        fit.missingEvidence.push("Median achieved sale price");
      } else {
        const median = Number(item.valueNumeric) * 100;
        const over = ((median - budget) / budget) * 100;
        c.evidenceIds.push(item.id);
        c.outcome = over <= 0 ? "meets" : over <= t.budgetPartlyPct ? "partly_meets" : "does_not_meet";
        c.reason = `Median ${formatMetric(item.unit, item.valueNumeric)} vs ${(budget / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 })} (${over <= 0 ? `${Math.abs(over).toFixed(1)}% below` : `${over.toFixed(1)}% above`}).${mismatchNote(mismatch, item)}${evidenceNote(item)}`;
      }
      fit.criteria.push(c);
    }

    if (purpose === "investment" || purpose === "undecided") {
      // 2. Rental demand via vacancy rate.
      const { item, mismatch } = latest(evidence, area, "vacancy_rate", typeKey);
      const c: CriterionResult = { key: "rental_demand", label: "Rental demand (vacancy rate)", basedOn: "Investment purpose", outcome: "unknown", reason: "", evidenceIds: [], threshold: `Meets ≤ ${t.vacancyMeetsPct}%, partly ≤ ${t.vacancyPartlyPct}%` };
      if (!item) {
        c.reason = "No dated vacancy rate recorded for this area.";
        fit.missingEvidence.push("Rental vacancy rate");
      } else {
        const v = Number(item.valueNumeric);
        c.evidenceIds.push(item.id);
        c.outcome = v <= t.vacancyMeetsPct ? "meets" : v <= t.vacancyPartlyPct ? "partly_meets" : "does_not_meet";
        c.reason = `Vacancy ${v}%.${mismatchNote(mismatch, item)}${evidenceNote(item)}`;
      }
      fit.criteria.push(c);

      // 3. Income priority via area gross yield (only when the buyer prioritises income).
      if (priority === "income" || priority === "balanced") {
        const y = latest(evidence, area, "gross_rental_yield", typeKey);
        const yc: CriterionResult = { key: "income_yield", label: "Area rental yield supports income priority", basedOn: `Income vs growth priority: ${priority}`, outcome: "unknown", reason: "", evidenceIds: [], threshold: `Meets ≥ ${t.incomeYieldMeetsPct}%, partly ≥ ${t.incomeYieldPartlyPct}% (area-level, not property cashflow)` };
        if (!y.item) {
          yc.reason = "No dated area gross yield recorded.";
          fit.missingEvidence.push("Area gross rental yield");
        } else {
          const v = Number(y.item.valueNumeric);
          yc.evidenceIds.push(y.item.id);
          yc.outcome = v >= t.incomeYieldMeetsPct ? "meets" : v >= t.incomeYieldPartlyPct ? "partly_meets" : "does_not_meet";
          yc.reason = `Area gross yield ${v}%.${mismatchNote(y.mismatch, y.item)}${evidenceNote(y.item)}`;
        }
        fit.criteria.push(yc);
      }
    }

    // 4. Property type preference is recorded; availability needs listing data (P1) → Unknown unless sales activity evidence exists.
    {
      const { item } = latest(evidence, area, "sales_volume_12m", typeKey);
      const c: CriterionResult = { key: "market_activity", label: `Enough ${typeKey === "all" ? "" : typeKey + " "}sales activity to buy`, basedOn: propertyType ? `Preferred property type: ${propertyType}` : "Property type not confirmed", outcome: "unknown", reason: "", evidenceIds: [], threshold: "Meets ≥ 50 sales in 12 months, partly ≥ 20" };
      if (!item) c.reason = "No sales activity evidence recorded.";
      else {
        const v = Number(item.valueNumeric);
        c.evidenceIds.push(item.id);
        c.outcome = v >= 50 ? "meets" : v >= 20 ? "partly_meets" : "does_not_meet";
        c.reason = `${v} sales in the last 12 months.${evidenceNote(item)}`;
      }
      fit.criteria.push(c);
    }
    return fit;
  });
}

/**
 * CON08 goal conflicts: a fixed budget, mandatory areas and an essential property type that the
 * evidence shows cannot all be met. Asks which constraint can change — never relaxes one silently.
 */
export function detectGoalConflicts(view: ProfileView, fits: AreaFit[]) {
  const fixedBudget = view.get<boolean>("preferences.budgetFixed") === true;
  const mandatoryAreas = view.get<string>("preferences.areasMandatory") === "mandatory";
  const typeEssential = view.get<boolean>("preferences.propertyTypeMandatory") === true;
  if (!fixedBudget || !mandatoryAreas) return [];
  const active = fits.filter((f) => !f.excluded);
  if (!active.length) return [];
  const allOver = active.every((f) => f.criteria.find((c) => c.key === "budget")?.outcome === "does_not_meet");
  if (!allOver) return [];
  const constraints = [
    { path: "preferences.budgetMax", label: "Budget" },
    { path: "preferences.areas", label: "Areas" },
    ...(typeEssential ? [{ path: "preferences.propertyType", label: "Property type" }] : []),
    ...(view.known("preferences.bedroomsMin") ? [{ path: "preferences.bedroomsMin", label: "Minimum bedrooms" }] : []),
  ];
  return [
    {
      key: "budget_area_type",
      description: `The fixed budget is below the median achieved price for the preferred property type in every mandatory area (${active.map((f) => f.area).join(", ")}). Which constraint can change?`,
      constraints,
    },
  ];
}
