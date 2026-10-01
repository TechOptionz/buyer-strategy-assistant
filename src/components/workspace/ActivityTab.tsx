"use client";

import { useMemo, useState } from "react";
import { Card, cx, EmptyState, Segmented } from "@/components/ui";
import { date, time } from "@/lib/format";
import { labelFor } from "@/lib/profile/fields";
import { useWs } from "./context";

type Event = ReturnType<typeof useWs>["ws"]["activity"][number];

const GROUPS: Record<string, string> = { profile: "Profile", facts: "Profile", notes: "Interview", turn: "Interview", scenario: "Scenarios", report: "Report", research: "Suburbs", market: "Suburbs", assessment: "Case", export: "Report" };

/** Readable text for an audit event. Audit details hold field paths and counts only — never values. */
export function describeEvent(e: Event): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const paths = Array.isArray(d.paths) ? (d.paths as string[]) : Array.isArray(d.changedPaths) ? (d.changedPaths as string[]) : [];
  const fields = paths.length ? `: ${paths.slice(0, 3).map((p) => labelFor(p)).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}` : "";
  const n = typeof d.count === "number" ? d.count : typeof d.proposed === "number" ? d.proposed : null;
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const REPORT: Record<string, string> = { draft: "Draft", ready_for_review: "Ready for review", needs_changes: "Changes requested", reviewed: "Reviewed", superseded: "Superseded" };
  switch (e.action) {
    case "assessment.create":
      return "Case created";
    case "notes.submit":
      return `Meeting notes pasted${typeof d.chars === "number" ? ` (${d.chars.toLocaleString("en-AU")} characters)` : ""}`;
    case "turn.free_text":
      return "Free-text answer added to the interview";
    case "research.areas":
      return `Research areas updated${n != null ? ` (${n})` : ""}`;
    case "profile.set":
      return `Profile updated${fields}`;
    case "facts.confirm":
      return `${n != null ? plural(n, "fact") : "Facts"} confirmed${fields}`;
    case "facts.reject":
      return `Suggested facts rejected${fields}`;
    case "conflict.resolve":
      return `Conflict resolved${typeof d.path === "string" ? `: ${labelFor(d.path)}` : ""}`;
    case "scenario.create":
      return `${typeof d.kind === "string" ? `${d.kind.charAt(0).toUpperCase()}${d.kind.slice(1)} scenario` : "Scenario"} calculated${Array.isArray(d.changes) && d.changes.length ? ` (${plural(d.changes.length, "change")})` : ""}`;
    case "scenario.archive":
      return "Scenario archived";
    case "report.create":
      return `Report${typeof d.version === "number" ? ` v${d.version}` : ""} drafted${typeof d.narrativeSource === "string" ? ` · ${d.narrativeSource === "ai" ? "AI-drafted narrative" : "template narrative"}` : ""}`;
    case "report.edit":
      return "Report commentary edited";
    case "report.submit":
      return "Report submitted for review";
    case "report.approve":
      return "Report approved as reviewed";
    case "report.request_changes":
      return "Reviewer requested changes";
    case "report.export":
      return `PDF exported${typeof d.status === "string" ? ` (${REPORT[d.status] ?? d.status})` : ""}`;
    case "report.download":
      return "PDF downloaded";
    case "evidence.add":
      return "Manual market evidence added";
    case "evidence.delete":
      return "Market evidence deleted";
    case "evidence.lookup":
      return `Market data looked up${typeof d.status === "string" ? ` · ${d.status.replaceAll("_", " ")}` : ""}`;
    default: {
      const [obj, verb = ""] = e.action.split(".");
      const what = obj.replaceAll("_", " ");
      const v = verb.replaceAll("_", " ");
      const text = `${what.charAt(0).toUpperCase()}${what.slice(1)} ${v}`.trim();
      return `${text}${fields}${n != null && !fields ? ` (${n})` : ""}`;
    }
  }
}

export function ActivityTab() {
  const { ws } = useWs();
  const [filter, setFilter] = useState<string>("all");
  const groups = useMemo(() => [...new Set(ws.activity.map((e) => GROUPS[e.action.split(".")[0]] ?? "Case"))], [ws.activity]);
  const shown = filter === "all" ? ws.activity : ws.activity.filter((e) => (GROUPS[e.action.split(".")[0]] ?? "Case") === filter);
  const byDay = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const e of shown) m.set(date(e.createdAt), [...(m.get(date(e.createdAt)) ?? []), e]);
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="flex flex-col gap-4 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[13px] text-ink-secondary">Every change to this case is recorded with who made it and when. The log never stores buyer financial values.</p>
        {groups.length > 1 && <Segmented label="Filter activity" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, ...groups.map((g) => ({ value: g, label: g }))]} />}
      </div>
      <Card flush className="max-w-[920px]">
        {shown.length === 0 ? (
          <div className="px-5">
            <EmptyState title="No activity yet">Changes to the profile, scenarios and reports will appear here.</EmptyState>
          </div>
        ) : (
          byDay.map(([day, events]) => (
            <div key={day}>
              <div className="border-b border-line bg-subtle px-5 py-2 text-xs font-medium text-muted">{day}</div>
              <ol>
                {events.map((e) => (
                  <li key={e.id} className="grid grid-cols-[56px_1fr] gap-3 border-b border-line-soft px-5 py-2.5 last:border-b-0 md:grid-cols-[56px_1fr_180px]">
                    <span className="text-xs text-muted tabular-nums">{time(e.createdAt)}</span>
                    <span className="text-[13px] text-ink-2">{describeEvent(e)}</span>
                    <span className={cx("col-start-2 text-xs text-muted md:col-start-3 md:text-right")}>{e.actorId ? (ws.people[e.actorId] ?? "Former member") : "System"}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
