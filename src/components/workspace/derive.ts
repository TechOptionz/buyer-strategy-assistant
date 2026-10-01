"use client";

import type { MarkKind } from "@/components/ui";
import { date, money, SOURCE_LABEL } from "@/lib/format";
import type { ScenarioInputs, ScenarioResult } from "@/lib/finance/types";
import { fieldDef, formatValue, labelFor, patternOf } from "@/lib/profile/fields";
import type { Workspace } from "@/lib/services/assessments";

type WS = Workspace;
export type Scn = WS["scenarios"][number];
export const inputsOf = (s: Scn) => s.inputs as ScenarioInputs;
export const resultOf = (s: Scn) => s.result as ScenarioResult;

export const STATE_LABEL: Record<string, string> = { unknown: "Unknown", not_applicable: "Not applicable", declined: "Not disclosed" };

const FINANCE_CONFIRMED = new Set(["pre_approval", "formal_approval"]);

export function financeConfirmed(ws: WS) {
  return FINANCE_CONFIRMED.has(String(ws.profile.confirmed["finance.confirmationStatus"]?.value ?? ""));
}

/** Status mark for one profile field, following the design's StatusMark kinds. */
export function markFor(ws: WS, path: string): { kind: MarkKind; label?: string } {
  if (ws.profile.conflicts[path]) return { kind: "review", label: "Needs review" };
  const c = ws.profile.confirmed[path];
  if (c) {
    if (c.state !== "value") return { kind: "missing", label: STATE_LABEL[c.state] };
    if (c.value === "not_sure") return { kind: "review", label: "Not sure" };
    const pattern = patternOf(path);
    if (pattern === "finance.borrowingLimit" && !financeConfirmed(ws)) return { kind: "notconfirmed" };
    if (pattern === "properties.*.value") return { kind: "estimated", label: "Client estimate" };
    if (fieldDef(path)?.topic === "scenario") return { kind: "assumption" };
    return { kind: "confirmed" };
  }
  if (ws.profile.proposed.some((f) => f.fieldPath === path)) return { kind: "suggested" };
  return { kind: "notasked" };
}

/** Display value for a field: confirmed, conflicted ("A or B"), proposed or "—". */
export function valueFor(ws: WS, path: string): { text: string; muted: boolean } {
  const conflict = ws.profile.conflicts[path];
  if (conflict) return { text: conflict.map((f) => (f.valueState === "value" ? formatValue(path, f.value) : STATE_LABEL[f.valueState])).join(" or "), muted: false };
  const c = ws.profile.confirmed[path];
  if (c) return c.state === "value" ? { text: formatValue(path, c.value), muted: false } : { text: STATE_LABEL[c.state] ?? "—", muted: true };
  const p = ws.profile.proposed.find((f) => f.fieldPath === path);
  if (p) return { text: p.valueState === "value" ? formatValue(path, p.value) : STATE_LABEL[p.valueState], muted: false };
  return { text: "—", muted: true };
}

/** SourceLabel text: "Meeting notes · Alex Tran · 01 Oct 2026". */
export function sourceFor(ws: WS, path: string): string {
  const conflict = ws.profile.conflicts[path];
  if (conflict) return `${conflict.length} sources disagree`;
  const c = ws.profile.confirmed[path];
  if (c) {
    const parts = [SOURCE_LABEL[c.sourceType] ?? c.sourceType];
    if (c.confirmedById && ws.people[c.confirmedById]) parts.push(ws.people[c.confirmedById]);
    if (c.confirmedAt) parts.push(date(c.confirmedAt));
    return parts.join(" · ");
  }
  const p = ws.profile.proposed.find((f) => f.fieldPath === path);
  if (p) return `${SOURCE_LABEL[p.sourceType] ?? p.sourceType} · ${p.proposedBy === "ai" ? "AI suggested" : "extracted"}`;
  return fieldDef(path)?.material === false ? "Optional" : "Not yet asked";
}

export function get<T = unknown>(ws: WS, path: string): T | undefined {
  const c = ws.profile.confirmed[path];
  return c && c.state === "value" ? (c.value as T) : undefined;
}

export const PURPOSE_SHORT: Record<string, string> = { ppor: "Home", investment: "Investment", undecided: "Undecided" };

/** The case status shown in the header and list: case lifecycle refined by the latest report. */
export function caseStatus(ws: WS): string {
  if (Object.keys(ws.profile.conflicts).length) return "needs_clarification";
  const r = ws.reports[0]?.status;
  // A reviewer's "request changes" also moves the case to needs_clarification; show the specific reason.
  if (r === "needs_changes") return "needs_changes";
  if (ws.assessment.status === "needs_clarification") return "needs_clarification";
  if (r === "ready_for_review" || ws.assessment.status === "ready_for_review") return "ready_for_review";
  if (r === "reviewed" || ws.assessment.status === "reviewed") return "reviewed";
  return ws.scenarios.length || ws.reports.length || ws.next.kind === "done" ? "assessing" : "draft";
}

/** The base scenario: the most recent non-stale "base", else the first scenario. */
export function baseScenario(ws: WS): Scn | null {
  const bases = ws.scenarios.filter((s) => s.kind === "base");
  return bases.find((s) => !s.staleBecause.length) ?? bases.at(-1) ?? ws.scenarios[0] ?? null;
}

/** "Borrowing limit $760,000 incl. equity draw · Client-supplied · 24 Sep 2026" */
export function borrowingLine(ws: WS): string | null {
  const limit = get<number>(ws, "finance.borrowingLimit");
  if (limit == null) return null;
  const scope = get<string>(ws, "finance.limitScope");
  const src = get<string>(ws, "finance.limitSource");
  const d = get<string>(ws, "finance.limitDate");
  return [`Borrowing limit ${money(limit)}${scope === "includes_equity_draw" ? " incl. equity draw" : scope === "purchase_loan_only" ? " purchase loan only" : ""}`, src, d ? date(d) : null].filter(Boolean).join(" · ");
}

export function outputLabel(key: string) {
  return key.replaceAll("_", " ");
}

export { labelFor, formatValue };
