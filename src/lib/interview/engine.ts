import { FIELDS, labelFor, TOPIC_LABELS, type Topic } from "../profile/fields";
import type { FactLike, ProfileView } from "../profile/state";
import { expandQuestions, OUTPUT_LABELS, type ExpandedQuestion, type OutputKey } from "./registry";
import { evaluate } from "./rules";

export interface GoalConflict {
  key: string;
  description: string;
  constraints: { path: string; label: string }[];
}

export interface InterviewContext {
  /** Instance keys the agent explicitly skipped. Required gaps stay visible. */
  skipped: Set<string>;
  /** Outputs the agent is working towards. */
  requestedOutputs: OutputKey[];
  goalConflicts: GoalConflict[];
}

export type NextStep =
  | { kind: "conflict"; path: string; label: string; facts: FactLike[] }
  | { kind: "goal_conflict"; conflict: GoalConflict }
  | { kind: "question"; question: ExpandedQuestion; stage: "purpose" | "required" | "optional" }
  | { kind: "review_proposed"; count: number }
  | { kind: "done" };

export function eligibleQuestions(view: ProfileView): ExpandedQuestion[] {
  return expandQuestions(view.propertyIndexes()).filter(
    (q) => (!q.eligibleWhen || evaluate(q.eligibleWhen, view)) && q.prerequisites.every((p) => view.answered(p)),
  );
}

const unanswered = (q: ExpandedQuestion, view: ProfileView) => q.targets.some((t) => !view.answered(t));

export function defaultOutputs(view: ProfileView): OutputKey[] {
  const purpose = view.get<string>("goals.purchasePurpose");
  const base: OutputKey[] = ["buyer_summary", "area_fit", "deposit_scenario", "funding_ceiling", "affordability_conclusion"];
  if (purpose !== "ppor") base.splice(3, 0, "rental_cashflow");
  return base;
}

/**
 * Select the single most useful next step (CON02):
 * 1. resolve blocking contradictions; 2. determine purchase purpose; 3. collect missing fields for
 * the requested outputs; 4. resolve ambiguous / proposed facts; 5. optional preferences.
 * Confirmed answers are never re-asked (CON04).
 */
export function nextStep(view: ProfileView, ctx: InterviewContext): NextStep {
  const conflictPaths = Object.keys(view.state.conflicts);
  if (conflictPaths.length) {
    const path = conflictPaths[0];
    return { kind: "conflict", path, label: labelFor(path), facts: view.state.conflicts[path] };
  }
  if (ctx.goalConflicts.length) return { kind: "goal_conflict", conflict: ctx.goalConflicts[0] };

  const eligible = eligibleQuestions(view).filter((q) => unanswered(q, view) && !ctx.skipped.has(q.instanceKey));

  const purpose = eligible.find((q) => q.key === "purchase_purpose");
  if (purpose) return { kind: "question", question: purpose, stage: "purpose" };

  const wanted = new Set(ctx.requestedOutputs);
  const required = eligible
    .filter((q) => !q.optional && q.requiredFor.some((o) => wanted.has(o)))
    .sort((a, b) => a.priority - b.priority || (a.propertyIndex ?? 0) - (b.propertyIndex ?? 0));
  // Proposed facts that would answer a required question are reviewed before asking it again.
  const proposedPaths = new Set(view.state.proposed.map((f) => f.fieldPath));
  const requiredNotProposed = required.filter((q) => !q.targets.every((t) => proposedPaths.has(t)));
  if (requiredNotProposed.length) return { kind: "question", question: requiredNotProposed[0], stage: "required" };

  if (view.state.proposed.length) return { kind: "review_proposed", count: view.state.proposed.length };

  const optional = eligible.filter((q) => q.optional || !q.requiredFor.some((o) => wanted.has(o))).sort((a, b) => a.priority - b.priority);
  if (optional.length) return { kind: "question", question: optional[0], stage: "optional" };
  return { kind: "done" };
}

/** The question shown before `currentKey` in registry order, for the Back control (CON05). */
export function previousQuestion(view: ProfileView, currentKey: string | null, answeredKeys: string[]): string | null {
  if (!answeredKeys.length) return null;
  const idx = currentKey ? answeredKeys.lastIndexOf(currentKey) : -1;
  return idx > 0 ? answeredKeys[idx - 1] : answeredKeys[answeredKeys.length - 1];
}

// ───────────────────────────── Output readiness (Section 6) ─────────────────────────────

export type ReadinessStatus = "ready" | "partial" | "not_ready";

export interface OutputReadiness {
  output: OutputKey;
  label: string;
  status: ReadinessStatus;
  missing: { path: string; label: string }[];
  unresolved: string[];
  summary: string;
}

export interface ReadinessExtras {
  /** Count of dated market evidence items per area. */
  evidenceByArea: Record<string, number>;
}

function need(view: ProfileView, paths: string[]) {
  return paths.filter((p) => !view.known(p)).map((p) => ({ path: p, label: labelFor(p) }));
}
function needAnswered(view: ProfileView, paths: string[]) {
  return paths.filter((p) => !view.answered(p)).map((p) => ({ path: p, label: labelFor(p) }));
}

export function readiness(view: ProfileView, extras: ReadinessExtras): OutputReadiness[] {
  const purpose = view.get<string>("goals.purchasePurpose");
  const props = view.propertyIndexes();
  const equity = view.get<boolean>("funding.equityDrawRequested") === true;
  const selling = props.some((i) => view.get(`properties.${i}.intention`) === "sell");
  const results: OutputReadiness[] = [];
  const conflicts = Object.keys(view.state.conflicts).map((p) => `Conflicting values for ${labelFor(p)}`);

  const make = (output: OutputKey, missing: { path: string; label: string }[], unresolved: string[], readyText: string) => {
    const allUnresolved = [...unresolved, ...conflicts];
    const status: ReadinessStatus = missing.length === 0 && unresolved.length === 0 ? "ready" : missing.length <= 2 ? "partial" : "not_ready";
    const parts: string[] = [];
    if (status === "ready") parts.push(readyText);
    if (missing.length) parts.push(`missing ${missing.slice(0, 3).map((m) => m.label.toLowerCase()).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`);
    if (unresolved.length) parts.push(unresolved.join("; "));
    results.push({ output, label: OUTPUT_LABELS[output], status, missing, unresolved: allUnresolved, summary: parts.join("; ") });
  };

  // Buyer summary: purpose and confirmed relevant facts; gaps remain visible.
  make("buyer_summary", need(view, ["goals.purchasePurpose"]), [], "Purpose confirmed; summary can be drafted with gaps shown");

  // Area fit: confirmed hard preferences and evidence. Missing evidence returns Unknown per criterion.
  {
    const missing = need(view, ["preferences.areas", "preferences.propertyType"]);
    const areas = view.get<string[]>("preferences.areas") ?? [];
    const unresolved: string[] = [];
    const noEvidence = areas.filter((a) => !extras.evidenceByArea[a.toLowerCase()]);
    if (areas.length && noEvidence.length) unresolved.push(`no dated market evidence yet for ${noEvidence.join(", ")} (criteria will show Unknown)`);
    make("area_fit", missing, unresolved, "Hard preferences confirmed and evidence recorded");
  }

  // Deposit scenario: explicit price, loan proceeds, costs, funding sources and reserve.
  {
    const paths = ["scenario.targetPrice", "scenario.purchaseCosts", "funds.cash", "funds.protectedReserve", "funds.earmarked"];
    const missing = need(view, paths);
    if (!view.known("scenario.purchaseLoanAmount") && !view.known("finance.lvrCapPct"))
      missing.push({ path: "finance.lvrCapPct", label: "Planned loan amount or LVR assumption" });
    if (equity) missing.push(...need(view, ["finance.equityDrawAmount"]));
    if (selling) missing.push(...need(view, ["funds.saleProceedsNet"]));
    const unresolved: string[] = [];
    if (selling && view.get("funds.saleProceedsBeforeSettlement") !== true) unresolved.push("sale proceeds timing unconfirmed (conditional funding)");
    make("deposit_scenario", missing, unresolved, "Scenario inputs complete");
  }

  if (purpose !== "ppor") {
    const missing = need(view, ["scenario.expectedWeeklyRent", "scenario.vacantWeeks", "scenario.annualOperatingCosts", "finance.interestRatePct", "finance.loanTermYears", "finance.repaymentType"]);
    if (equity) missing.push(...need(view, ["finance.equityDrawAmount"]));
    make("rental_cashflow", missing, [], "Rent, vacancy, costs and loan terms complete");
  }

  // Funding ceiling: explicit funding, cost basis, valuation and LVR, borrowing-limit scope.
  {
    const missing = need(view, ["funds.cash", "funds.protectedReserve", "funds.earmarked", "scenario.purchaseCosts", "finance.lvrCapPct", "finance.borrowingLimit"]);
    const unresolved: string[] = [];
    if (equity) {
      missing.push(...need(view, ["finance.equityDrawAmount"]));
      const scope = view.get<string>("finance.limitScope");
      if (!scope) missing.push({ path: "finance.limitScope", label: labelFor("finance.limitScope") });
      else if (scope === "not_sure") unresolved.push("borrowing-limit scope unresolved");
      for (const i of props) {
        if (view.get(`properties.${i}.ownershipStructure`) === "tenants_in_common" && view.get(`properties.${i}.securityArrangementResolved`) !== true)
          unresolved.push(`co-ownership security arrangement for property ${i} unresolved`);
      }
    }
    if (view.get("finance.confirmationStatus") !== "pre_approval" && view.get("finance.confirmationStatus") !== "formal_approval")
      unresolved.push("finance limit unconfirmed");
    make("funding_ceiling", missing, unresolved, "Funding ceiling can be calculated");
  }

  // Affordability: household commitments and a confirmed finance assessment. A ceiling alone is not enough.
  {
    const missing = [
      ...need(view, ["household.income.amount", "household.income.frequency", "household.income.basis", "household.expenses.amount", "household.expenses.frequency"]),
      ...needAnswered(view, ["household.dependants", "household.otherCommitmentsMonthly", "household.creditLimits"]),
    ];
    for (const i of props) if (view.get(`properties.${i}.intention`) !== "sell") missing.push(...needAnswered(view, [`properties.${i}.debt`]));
    const unresolved: string[] = [];
    const status = view.get<string>("finance.confirmationStatus");
    if (status !== "pre_approval" && status !== "formal_approval")
      unresolved.push("requires a confirmed finance assessment (pre-approval or formal approval) — a funding ceiling alone cannot establish affordability");
    make("affordability_conclusion", missing, unresolved, "Household commitments and finance assessment confirmed");
  }
  return results;
}

/** Plain-language readiness line, e.g. "Scenario inputs complete; finance limit unresolved" (CON07). */
export function readinessHeadline(items: OutputReadiness[]): string {
  const ready = items.filter((i) => i.status === "ready").map((i) => i.label);
  const blocked = items.filter((i) => i.status !== "ready");
  const parts: string[] = [];
  if (ready.length) parts.push(`${ready.join(", ")} ready`);
  if (blocked.length) parts.push(`${blocked.map((b) => b.label).join(", ")} incomplete`);
  return parts.join("; ");
}

export interface TopicProgress {
  topic: Topic;
  label: string;
  answered: number;
  total: number;
}

/** Completion by topic, counted over currently eligible, required questions only (CON07). */
export function topicProgress(view: ProfileView): TopicProgress[] {
  const eligible = eligibleQuestions(view).filter((q) => !q.optional);
  const topics = [...new Set(FIELDS.map((f) => f.topic))];
  return topics
    .map((topic) => {
      const qs = eligible.filter((q) => q.topic === topic);
      const total = qs.reduce((n, q) => n + q.targets.length, 0);
      const answered = qs.reduce((n, q) => n + q.targets.filter((t) => view.answered(t)).length, 0);
      return { topic, label: TOPIC_LABELS[topic], answered, total };
    })
    .filter((t) => t.total > 0);
}
