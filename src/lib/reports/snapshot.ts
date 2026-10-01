import type { ScenarioChange, ScenarioResult } from "../finance";
import { describeChange } from "../finance/patch";
import { compareResults, explainDeltas, type MetricDelta } from "../finance/compare";
import type { OutputReadiness } from "../interview/engine";
import { type AreaFit, type EvidenceItem, FIT_LABELS } from "../market/fit";
import { formatMetric, freshness, metricDef } from "../market/metrics";
import { FIELDS, formatValue, labelFor, TOPIC_LABELS, type Topic } from "../profile/fields";
import { unitOf } from "../profile/units";
import type { ProfileView } from "../profile/state";
import { formatAUD } from "../parse/numbers";
import { SECTION_KEYS, SECTION_TITLES, type SectionKey } from "./narrative";

export interface SnapshotScenario {
  id: string;
  name: string;
  kind: string;
  calculationVersion: string;
  inputHash: string;
  profileRevision: number;
  changes: string[];
  labels: string[];
  result: ScenarioResult;
  purpose: string | null;
}

export interface ReportSnapshot {
  generatedAt: string;
  buyerDisplayName: string;
  agentName: string;
  brandName: string;
  profileRevision: number;
  scope: { areaAssessment: boolean; purchaseBudget: boolean; affordability: boolean };
  profile: { topic: string; items: { label: string; value: string }[] }[];
  unresolved: string[];
  readiness: { label: string; status: string; summary: string }[];
  scenarios: SnapshotScenario[];
  comparisons: { name: string; against: string; deltas: MetricDelta[]; benefits: string[]; tradeOffs: string[] }[];
  areas: { area: string; excluded: boolean; exclusionReason?: string; criteria: { label: string; basedOn: string; outcome: string; reason: string; evidenceIds: string[]; threshold?: string }[]; missingEvidence: string[] }[];
  evidence: { id: string; area: string; metric: string; value: string; propertyType: string; period: string; source: string; observedAt: string; ageDays: number; stale: boolean; isSample: boolean; provider: string }[];
  nextActions: string[];
  /** Placeholder values for narrative: ref → formatted saved value. */
  values: Record<string, string>;
  valueLabels: Record<string, string>;
  financeConfirmed: boolean;
  attribution: string | null;
  /** Organisation report footer (licence number, disclaimer), frozen with the snapshot. Absent on older reports. */
  reportFooter?: string | null;
}

export interface ReportSection {
  key: SectionKey;
  title: string;
  narrative: string;
  commentary: string;
}

const REPORT_TOPICS: Topic[] = ["goals", "household", "properties", "funds", "finance", "preferences", "scenario"];

const signedMoney = (cents: number, withCents = false) => `${cents >= 0 ? "+" : "-"}${formatAUD(Math.abs(cents), { cents: withCents })}`;

export function buildSnapshot(args: {
  view: ProfileView;
  buyerDisplayName: string;
  agentName: string;
  brandName: string;
  profileRevision: number;
  readiness: OutputReadiness[];
  scenarios: {
    id: string;
    name: string;
    kind: string;
    calculationVersion: string;
    inputHash: string;
    profileRevision: number;
    changes: ScenarioChange[];
    assumptionLabels: Record<string, string>;
    result: ScenarioResult;
    purpose: string | null;
  }[];
  fits: AreaFit[];
  evidence: EvidenceItem[];
  includeAreas: boolean;
  attribution: string | null;
  reportFooter?: string | null;
}): ReportSnapshot {
  const { view } = args;
  const values: Record<string, string> = {};
  const valueLabels: Record<string, string> = {};
  const put = (ref: string, label: string, v: string | null) => {
    if (v == null || v === "—") return;
    values[ref] = v;
    valueLabels[ref] = label;
  };

  // Confirmed profile, formatted. Raw notes and internal identifiers are never included (REP04).
  const profile: ReportSnapshot["profile"] = [];
  for (const topic of REPORT_TOPICS) {
    const items: { label: string; value: string }[] = [];
    for (const [path, r] of Object.entries(view.state.confirmed)) {
      const def = FIELDS.find((f) => f.path === path.replace(/\.\d+\./, ".*."));
      if (!def || def.topic !== topic) continue;
      const value =
        r.state === "value" ? `${formatValue(path, r.value)}${unitOf(path, (p) => view.get<string>(p))}` : r.state === "unknown" ? "Unknown" : r.state === "declined" ? "Not disclosed" : "Not applicable";
      items.push({ label: labelFor(path), value });
      if (r.state === "value") put(`fact.${path}`, labelFor(path), `${formatValue(path, r.value)}${unitOf(path, (p) => view.get<string>(p))}`);
    }
    if (items.length) profile.push({ topic: TOPIC_LABELS[topic], items });
  }

  const unresolved = [
    ...Object.keys(view.state.conflicts).map((p) => `Conflicting values recorded for ${labelFor(p)} — excluded until resolved`),
    ...args.readiness.filter((r) => r.status !== "ready").map((r) => `${r.label}: ${r.summary}`),
  ];

  const scenarios: SnapshotScenario[] = args.scenarios.map((s, i) => {
    const n = `s${i + 1}`;
    const f = s.result.funding;
    const c = s.result.cashflow;
    put(`${n}.cashRequired`, `${s.name}: cash required at settlement`, f.cashRequiredCents != null ? formatAUD(f.cashRequiredCents) : null);
    put(`${n}.availableFunding`, `${s.name}: funding available excluding reserve`, f.availableFundingCents != null ? formatAUD(f.availableFundingCents) : null);
    put(`${n}.fundingSurplus`, `${s.name}: funding surplus (shortfall)`, f.fundingSurplusCents != null ? formatAUD(f.fundingSurplusCents) : null);
    put(`${n}.cashRemaining`, `${s.name}: cash remaining including reserve`, f.cashRemainingIncludingReserveCents != null ? formatAUD(f.cashRemainingIncludingReserveCents) : null);
    put(`${n}.headroom`, `${s.name}: theoretical headroom`, f.theoreticalHeadroomCents != null ? formatAUD(f.theoreticalHeadroomCents) : null);
    put(`${n}.newLvr`, `${s.name}: new property LVR`, f.newPropertyLvrPct != null ? `${f.newPropertyLvrPct}%` : null);
    put(`${n}.debtService`, `${s.name}: annual incremental debt service`, c.annualIncrementalDebtServiceCents != null ? formatAUD(c.annualIncrementalDebtServiceCents) : null);
    put(`${n}.annualCashflow`, `${s.name}: annual incremental cashflow`, c.annualIncrementalCashflowCents != null ? formatAUD(c.annualIncrementalCashflowCents) : null);
    put(`${n}.monthlyCashflow`, `${s.name}: average monthly cashflow`, c.averageMonthlyCashflowCents != null ? formatAUD(c.averageMonthlyCashflowCents, { cents: true }) : null);
    put(`${n}.grossYield`, `${s.name}: gross rental yield`, c.grossRentalYieldPct != null ? `${Number(c.grossRentalYieldPct).toFixed(2)}%` : null);
    put(`${n}.netYield`, `${s.name}: net rental yield`, c.netRentalYieldPct != null ? `${Number(c.netRentalYieldPct).toFixed(2)}%` : null);
    put(`${n}.ownershipCost`, `${s.name}: annual ownership cost`, c.annualOwnershipCostCents != null ? formatAUD(c.annualOwnershipCostCents) : null);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      calculationVersion: s.calculationVersion,
      inputHash: s.inputHash,
      profileRevision: s.profileRevision,
      changes: s.changes.map(describeChange),
      labels: Object.values(s.assumptionLabels),
      result: s.result,
      purpose: s.purpose,
    };
  });

  const comparisons: ReportSnapshot["comparisons"] = [];
  if (args.scenarios.length > 1) {
    const base = args.scenarios[0];
    args.scenarios.slice(1).forEach((other, j) => {
      const deltas = compareResults(base.result, other.result);
      for (const d of deltas) {
        if (d.delta == null) continue;
        const text =
          d.kind === "money"
            ? signedMoney(d.delta as number, d.key === "monthlyCashflow")
            : `${Number(d.delta) >= 0 ? "+" : "-"}${Math.abs(Number(d.delta)).toFixed(2)} percentage points`;
        put(`c${j + 1}.${d.key}`, `${other.name} vs ${base.name}: change in ${d.label.toLowerCase()}`, text);
      }
      comparisons.push({ name: other.name, against: base.name, deltas, ...explainDeltas(deltas) });
    });
  }

  const usedEvidence = new Set(args.fits.flatMap((f) => f.criteria.flatMap((c) => c.evidenceIds)));
  const evidence = args.includeAreas
    ? args.evidence
        .filter((e) => usedEvidence.has(e.id))
        .map((e) => {
          const fr = freshness(e.metric, e.observedAt);
          return {
            id: e.id,
            area: e.area,
            metric: metricDef(e.metric)?.label ?? e.metric,
            value: formatMetric(e.unit, e.valueNumeric),
            propertyType: e.propertyType,
            period: e.periodEnd,
            source: e.sourceDescription,
            observedAt: e.observedAt,
            ageDays: fr.ageDays,
            stale: fr.state === "stale",
            isSample: e.isSample,
            provider: e.provider,
          };
        })
    : [];

  const areas = args.includeAreas ? args.fits.map((f) => ({ ...f, criteria: f.criteria.map((c) => ({ ...c, outcome: FIT_LABELS[c.outcome] })) })) : [];

  const ready = (k: string) => args.readiness.find((r) => r.output === k)?.status === "ready";
  const financeConfirmed = ["pre_approval", "formal_approval"].includes(view.get<string>("finance.confirmationStatus") ?? "");
  return {
    generatedAt: new Date().toISOString(),
    buyerDisplayName: args.buyerDisplayName,
    agentName: args.agentName,
    brandName: args.brandName,
    profileRevision: args.profileRevision,
    scope: {
      areaAssessment: args.includeAreas && areas.length > 0,
      purchaseBudget: ready("deposit_scenario") && scenarios.some((s) => s.result.funding.status === "complete"),
      affordability: ready("affordability_conclusion"),
    },
    profile,
    unresolved,
    readiness: args.readiness.map((r) => ({ label: r.label, status: r.status, summary: r.summary })),
    scenarios,
    comparisons,
    areas,
    evidence,
    nextActions: suggestNextActions(view, args.readiness, args.fits, args.evidence),
    values,
    valueLabels,
    financeConfirmed,
    attribution: args.attribution,
    reportFooter: args.reportFooter ?? null,
  };
}

/** ANA06: actions tied to specific gaps. The agent chooses which to keep in the report. */
export function suggestNextActions(view: ProfileView, ready: OutputReadiness[], fits: AreaFit[], evidence: EvidenceItem[]): string[] {
  const out: string[] = [];
  if (Object.keys(view.state.conflicts).length) out.push("Resolve conflicting values recorded in the buyer profile.");
  if (view.get("finance.limitScope") === "not_sure")
    out.push("Confirm with the broker whether the borrowing limit includes the equity release or covers only the new purchase loan.");
  const status = view.get<string>("finance.confirmationStatus");
  if (status !== "pre_approval" && status !== "formal_approval") out.push("Obtain a pre-approval or broker assessment before relying on any purchase budget.");
  if (!view.answered("funds.protectedReserve")) out.push("Agree the cash reserve the buyer wants to keep untouched.");
  if ((view.get<string>("goals.purchasePurpose") ?? "") !== "ppor" && !view.known("scenario.expectedWeeklyRent"))
    out.push("Obtain a dated rent estimate for the target property type.");
  if (!view.known("scenario.purchaseCosts")) out.push("Obtain dated quotes or estimates for duty, conveyancing, inspections and loan costs.");
  for (const f of fits) for (const m of f.missingEvidence) out.push(`Record dated ${m.toLowerCase()} evidence for ${f.area}.`);
  for (const e of evidence)
    if (freshness(e.metric, e.observedAt).state === "stale") out.push(`Refresh ${metricDef(e.metric)?.label.toLowerCase() ?? e.metric} for ${e.area} (stale).`);
  if (ready.find((r) => r.output === "affordability_conclusion")?.status !== "ready") out.push("Collect household commitments needed for an affordability conclusion.");
  return [...new Set(out)].slice(0, 12);
}

const KEY_DELTAS = ["cashRequired", "debtService", "annualCashflow", "monthlyCashflow", "cashRemaining", "ownershipCost"];

/** Deterministic template narrative used when AI is not configured or fails validation. */
export function templateSections(s: ReportSnapshot): Record<SectionKey, string> {
  const has = (ref: string) => ref in s.values;
  const v = (ref: string) => `{{${ref}}}`;
  const purposeFact = s.profile.flatMap((t) => t.items).find((i) => i.label === "Purchase purpose")?.value ?? "not yet confirmed";
  const scenarioLine = (i: number) => {
    const n = `s${i + 1}`;
    const sc = s.scenarios[i];
    const parts: string[] = [];
    if (has(`${n}.cashRequired`)) parts.push(`cash required at settlement is ${v(`${n}.cashRequired`)}`);
    if (has(`${n}.availableFunding`)) parts.push(`funding available excluding the protected reserve is ${v(`${n}.availableFunding`)}`);
    if (has(`${n}.annualCashflow`)) parts.push(`annual incremental cashflow is ${v(`${n}.annualCashflow`)} (an average of ${v(`${n}.monthlyCashflow`)} per month)`);
    if (has(`${n}.ownershipCost`)) parts.push(`annual ownership cost is ${v(`${n}.ownershipCost`)}`);
    return parts.length
      ? `In the "${sc.name}" scenario, ${parts.join("; ")}.`
      : `The "${sc.name}" scenario is incomplete because required inputs are missing.`;
  };

  const exec: string[] = [`This assessment covers ${s.buyerDisplayName}. The purchase purpose is ${purposeFact.toLowerCase()}.`];
  if (s.scenarios.length) exec.push(scenarioLine(0));
  exec.push(
    s.scope.purchaseBudget
      ? "Scenario figures are indicative and are not a lender's assessment."
      : "A purchase-budget conclusion is not included because the required inputs are incomplete.",
  );
  if (!s.financeConfirmed) exec.push("Finance has not been confirmed by a pre-approval or formal approval, so serviceability is not established.");
  if (s.scope.areaAssessment) exec.push("The area comparison is based on the dated evidence listed in the source table.");

  const downside = s.comparisons.map((c, j) => {
    const parts = KEY_DELTAS.filter((k) => has(`c${j + 1}.${k}`)).map(
      (k) => `${s.valueLabels[`c${j + 1}.${k}`].split(": change in ")[1]} changes by ${v(`c${j + 1}.${k}`)}`,
    );
    return `Compared with "${c.against}", in the "${c.name}" case ${parts.length ? parts.join("; ") : "no comparable figures are available"}.`;
  });

  return {
    executive_summary: exec.join(" "),
    buyer_goals: "The goals and preferences below were confirmed with the buyer. Items marked unknown or not disclosed are treated as gaps, not as zero.",
    financial_overview: "The financial position below lists only confirmed values. Superannuation is shown separately and is not counted as purchase funding.",
    options: s.scenarios.length
      ? `${s.scenarios.length === 1 ? "One scenario was" : "Several scenarios were"} modelled from the confirmed profile, with each changed assumption listed.`
      : "No scenarios have been calculated yet.",
    area_comparison: s.scope.areaAssessment
      ? "Each area is assessed criterion by criterion as Meets, Partly meets, Does not meet or Unknown, with the evidence and threshold used. Unknown means the evidence has not been recorded, not that the area fails."
      : "No area comparison is included in this report.",
    purchase_scenarios: s.scenarios.map((_, i) => scenarioLine(i)).join(" ") || "No purchase scenarios are included.",
    downside_cases:
      downside.join(" ") ||
      "No downside case has been calculated. A downside case with higher rates, lower rent and more vacancy is recommended before proceeding.",
    assumptions:
      "All figures are indicative scenario calculations, not a lender's underwriting assessment or loan approval. Personal tax effects are excluded. Historical price changes are context only, not growth forecasts. Unknown costs are not treated as zero.",
    next_steps: "The agent has selected the following next actions.",
  };
}

export const SECTION_ORDER = SECTION_KEYS.map((key) => ({ key, title: SECTION_TITLES[key] }));
