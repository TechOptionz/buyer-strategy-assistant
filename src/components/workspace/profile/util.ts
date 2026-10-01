"use client";

import { human } from "@/components/ui";
import { dateTime, money, rate, SOURCE_LABEL } from "@/lib/format";
import { fieldDef, formatValue, labelFor, type Topic } from "@/lib/profile/fields";
import { PERIOD_UNIT, unitOf } from "@/lib/profile/units";
import type { Workspace } from "@/lib/services/assessments";
import { get, STATE_LABEL } from "../derive";

type WS = Workspace;

export { PERIOD_UNIT };

const RATE_FIELDS = new Set(["properties.*.loanRatePct", "finance.interestRatePct", "scenario.growthAssumptionPct"]);

/** Unit shown after a value: periods on every flow (/yr, /mo, /wk). */
export function unitFor(ws: WS, path: string): string {
  return unitOf(path, (p) => get<string>(ws, p));
}

/** One value as text, following the number rules (true minus, rates to 2 dp). */
export function fmt(path: string, value: unknown): string {
  const def = fieldDef(path);
  if (value == null) return "—";
  if (value === "not_sure") return "Not sure";
  if (!def) return String(value);
  if (def.type === "money") return money(Number(value));
  if (def.type === "percent") return RATE_FIELDS.has(def.path) ? rate(value as number) : `${value}%`;
  return formatValue(path, value);
}

export type Display = { text: string; unit: string; muted: boolean };

/** Display value for a row: confirmed, conflicting ("A or B"), proposed, explicit state or "—". */
export function displayFor(ws: WS, path: string): Display {
  const unit = unitFor(ws, path);
  const conflict = ws.profile.conflicts[path];
  if (conflict) return { text: conflict.map((f) => (f.valueState === "value" ? fmt(path, f.value) : STATE_LABEL[f.valueState])).join(" or "), unit: "", muted: false };
  const c = ws.profile.confirmed[path];
  if (c) return c.state === "value" ? { text: fmt(path, c.value), unit: c.value === "not_sure" ? "" : unit, muted: false } : { text: STATE_LABEL[c.state] ?? "—", unit: "", muted: true };
  const p = ws.profile.proposed.find((f) => f.fieldPath === path);
  if (p) return p.valueState === "value" ? { text: fmt(path, p.value), unit, muted: false } : { text: STATE_LABEL[p.valueState] ?? "—", unit: "", muted: true };
  return { text: "—", unit: "", muted: true };
}

/** Gap = not confirmed, or confirmed values in conflict. */
export function isGap(ws: WS, path: string) {
  return !ws.profile.confirmed[path] || !!ws.profile.conflicts[path];
}

export const rowId = (path: string) => `profile-row-${path.replaceAll(".", "-")}`;

/** Topics whose changes invalidate purchase scenarios (mirrors the service rule). */
const SCENARIO_TOPICS: Topic[] = ["finance", "funds", "scenario", "properties", "household", "super"];

export function consequenceNote(ws: WS, path: string): string | undefined {
  const def = fieldDef(path);
  const affects = (def && SCENARIO_TOPICS.includes(def.topic)) || path === "goals.purchasePurpose" || path.startsWith("funding.") || path.startsWith("portfolio.");
  if (!affects) return undefined;
  const n = ws.scenarios.filter((s) => !s.staleBecause.length).length;
  if (!n) return undefined;
  return `Saving marks ${n} scenario${n === 1 ? "" : "s"} Out of date`;
}

export function personName(ws: WS, id: string | null | undefined) {
  return id ? ws.people[id] : undefined;
}

/** "Manual edit · Alex Tran · 01 Oct 2026, 10:48" */
export function whoWhen(ws: WS, sourceType: string | null | undefined, personId: string | null | undefined, at: string | Date | null | undefined) {
  return [sourceType ? (SOURCE_LABEL[sourceType] ?? human(sourceType)) : null, personName(ws, personId), at ? dateTime(at) : null].filter(Boolean).join(" · ");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Audit event → readable sentence. Audit details hold field paths and counts only, never values. */
export function activityText(a: WS["activity"][number]): string {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  const paths = Array.isArray(d.paths) ? (d.paths as string[]) : [];
  switch (a.action) {
    case "profile.set":
      return paths.length === 1 ? `${labelFor(paths[0]!)} updated` : `${plural(paths.length, "profile field")} updated`;
    case "facts.confirm":
      return `${plural(Number(d.count ?? paths.length), "fact")} confirmed`;
    case "facts.reject":
      return `${plural(paths.length, "suggestion")} rejected`;
    case "conflict.resolve":
      return typeof d.path === "string" ? `${labelFor(d.path)} conflict resolved` : "Conflict resolved";
    case "scenario.create":
      return typeof d.kind === "string" ? `${human(d.kind)} scenario calculated` : "Scenario calculated";
    case "scenario.archive":
      return "Scenario archived";
    case "notes.submit":
      return "Meeting notes added for extraction";
    case "turn.free_text":
      return "Message added to the interview";
    case "assessment.create":
      return "Case created";
    case "report.create":
      return d.version != null ? `Report v${d.version} created` : "Report created";
    case "report.edit":
      return "Report commentary edited";
    case "report.submit":
      return "Report submitted for review";
    case "report.approve":
    case "report.review":
      return "Report reviewed";
    case "report.request_changes":
      return "Changes requested on report";
    case "report.export":
      return "Report PDF requested";
    case "report.download":
      return "Report PDF downloaded";
    case "evidence.add":
      return "Market evidence added";
    case "evidence.delete":
      return "Market evidence removed";
    case "evidence.lookup":
      return "Market evidence looked up";
    case "research.areas":
      return "Research areas updated";
    default:
      return human(a.action.replaceAll(".", " "));
  }
}
