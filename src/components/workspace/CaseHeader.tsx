"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CaseStatusBadge, cx } from "@/components/ui";
import { pinStore } from "@/components/shell/pins";
import { api } from "@/lib/client/api";
import { money, relative } from "@/lib/format";
import { useWs, type TabKey } from "./context";
import { borrowingLine, caseStatus, financeConfirmed, get, PURPOSE_SHORT } from "./derive";

type TabMark = "done" | "review" | "stale" | "none";
const MARK: Record<TabMark, { icon: string; cls: string; title: string }> = {
  done: { icon: "✓", cls: "text-ok", title: "Complete" },
  review: { icon: "⚠︎", cls: "text-warn", title: "Needs review" },
  stale: { icon: "↻", cls: "text-warn", title: "Out of date" },
  none: { icon: "", cls: "", title: "" },
};

const FINANCE_STATUS: Record<string, string> = { broker_estimate: "Broker estimate", pre_approval: "Pre-approval", formal_approval: "Formal approval", none: "Not started" };

export function CaseHeader({ savedAt, onRetry }: { savedAt: string; onRetry: () => void }) {
  const { ws, save, tab, goTab } = useWs();
  const a = ws.assessment;
  const status = caseStatus(ws);
  const purpose = get<string>(ws, "goals.purchasePurpose");
  const target = get<number>(ws, "scenario.targetPrice") ?? get<number>(ws, "preferences.budgetMax");
  const conflicts = Object.keys(ws.profile.conflicts).length;
  const stale = ws.scenarios.some((s) => s.staleBecause.length > 0);
  const latestReport = ws.reports[0];
  const finOk = financeConfirmed(ws);
  const finStatus = get<string>(ws, "finance.confirmationStatus");
  const borrowing = borrowingLine(ws);
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.get, pinStore.server);
  const pinned = pins.includes(a.id);

  const tabs: { key: TabKey; label: string; mark: TabMark }[] = [
    { key: "interview", label: "Interview", mark: conflicts || ws.profile.proposed.length ? "review" : ws.next.kind === "done" ? "done" : "none" },
    { key: "profile", label: "Profile", mark: conflicts ? "review" : Object.keys(ws.profile.confirmed).length ? "done" : "none" },
    { key: "scenarios", label: "Scenario Lab", mark: stale ? "stale" : ws.scenarios.length ? "done" : "none" },
    { key: "report", label: "Report", mark: !latestReport ? "none" : latestReport.status === "reviewed" ? "done" : latestReport.status === "draft" ? "none" : "review" },
    { key: "activity", label: "Activity", mark: "none" },
  ];

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  return (
    <header className="border-b border-line bg-surface px-4 pt-4 md:px-8">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-xs text-muted">
        <Link href="/cases" className="text-ink-secondary">
          Cases
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{a.buyerDisplayName}</span>
      </nav>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-[22px] leading-snug font-semibold">{a.buyerDisplayName}</h1>
        <CaseStatusBadge status={status} />
        <span className="text-[13px] text-ink-secondary">
          {purpose ? PURPOSE_SHORT[purpose] : "Purpose not confirmed"}
          {target != null && ` · Target price ${money(target)}`}
        </span>
        {a.isSeed && <span className="text-xs text-muted">Fictional seed data</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => pinStore.toggle(a.id)} aria-pressed={pinned} className="rounded px-1.5 py-0.5 text-xs text-ink-secondary hover:bg-hover hover:text-ink">
          {pinned ? "★ Pinned" : "☆ Pin"}
        </button>
        <SaveIndicator save={save} savedAt={savedAt} onRetry={onRetry} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
        <span>Indicative only — not loan approval</span>
        <span aria-hidden="true" className="text-line-strong">
          |
        </span>
        {finOk ? (
          <span className="inline-flex gap-1 text-ok">
            <span aria-hidden="true">✓</span>Finance confirmed · {FINANCE_STATUS[finStatus ?? ""] ?? ""}
          </span>
        ) : (
          <span className="inline-flex gap-1 text-warn">
            <span aria-hidden="true">⚠︎</span>Finance not confirmed{finStatus && finStatus !== "none" ? ` · ${FINANCE_STATUS[finStatus] ?? finStatus}` : ""}
          </span>
        )}
        {borrowing && <span className="text-muted">{borrowing}</span>}
        <span aria-hidden="true" className="text-line-strong">
          |
        </span>
        <ReviewerControl />
        {!ws.permissions.canEdit && <span className="text-muted">· View only — editing needs assignment or the edit permission</span>}
      </div>
      <div
        role="tablist"
        aria-label="Case sections"
        className="-mb-px mt-3.5 flex gap-6 overflow-x-auto"
        onKeyDown={(e) => {
          const i = tabs.findIndex((t) => t.key === tab);
          const n = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : -1;
          if (n >= 0) {
            e.preventDefault();
            goTab(tabs[n].key);
            tabRefs.current[tabs[n].key]?.focus();
          }
        }}
      >
        {tabs.map((t) => {
          const on = t.key === tab;
          const m = MARK[t.mark];
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={on}
              aria-controls={`panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => goTab(t.key)}
              className={cx("flex h-9 shrink-0 items-center gap-1.5 border-b-2 text-sm whitespace-nowrap", on ? "border-accent font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink")}
            >
              {t.label}
              {m.icon && (
                <span className={cx("text-[11px]", m.cls)} title={m.title}>
                  <span aria-hidden="true">{m.icon}</span>
                  <span className="sr-only"> ({m.title})</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
}

/** Who reviews this case. Assignment is what lets a reviewer see the case at all. */
function ReviewerControl() {
  const { ws, mutate } = useWs();
  const [editing, setEditing] = useState(false);
  const current = ws.assessment.reviewerId;
  const name = current ? (ws.people[current] ?? "Former member") : null;
  const canAssign = ws.permissions.canEdit;
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <label htmlFor="case-reviewer" className="text-ink-secondary">
          Reviewer
        </label>
        <select
          id="case-reviewer"
          autoFocus
          defaultValue={current ?? ""}
          onChange={async (e) => {
            const reviewerId = e.target.value || null;
            setEditing(false);
            await mutate("Assign reviewer", () => api(`/api/assessments/${ws.assessment.id}/reviewer`, { method: "PUT", body: { reviewerId } }));
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="h-7 rounded border border-line-strong bg-surface px-1.5 text-xs"
        >
          <option value="">No reviewer</option>
          {ws.reviewers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.role === "org_admin" ? " (administrator)" : ""}
            </option>
          ))}
        </select>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {name ? (
        <span className="text-ink-secondary">Reviewer: {name}</span>
      ) : (
        <span className="inline-flex gap-1 text-warn">
          <span aria-hidden="true">⚠︎</span>No reviewer assigned
        </span>
      )}
      {canAssign && (
        <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
          {name ? "Change" : "Assign"}
        </button>
      )}
    </span>
  );
}

function SaveIndicator({ save, savedAt, onRetry }: { save: string; savedAt: string; onRetry: () => void }) {
  // Re-render each minute so "2 min ago" stays truthful.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span aria-live="polite" className="text-xs">
      {save === "saving" && <span className="text-muted">Saving…</span>}
      {save === "saved" && (
        <span className="inline-flex gap-1 text-muted">
          <span aria-hidden="true" className="text-ok">
            ✓
          </span>
          Saved · {relative(savedAt).toLowerCase() === "just now" ? "just now" : relative(savedAt)}
        </span>
      )}
      {save === "unsaved" && (
        <span className="inline-flex gap-1 text-warn">
          <span aria-hidden="true">●</span>Unsaved changes
        </span>
      )}
      {save === "failed" && (
        <span className="inline-flex items-center gap-1.5 text-bad">
          <span aria-hidden="true">⚠︎</span>Save failed — your entries are kept
          <button type="button" onClick={onRetry} className="font-medium text-accent hover:underline">
            Retry
          </button>
        </span>
      )}
    </span>
  );
}
