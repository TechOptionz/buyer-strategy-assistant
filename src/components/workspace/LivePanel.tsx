"use client";

import { useEffect, useState } from "react";
import { cx, Mark } from "@/components/ui";
import { labelFor, TOPIC_LABELS, type Topic } from "@/lib/profile/fields";
import { useWs } from "./context";
import { markFor, sourceFor, valueFor } from "./derive";
import { currentPaths, fieldOrder, topicOf } from "./interview/shared";

const TOPIC_ORDER = Object.keys(TOPIC_LABELS) as Topic[];

type Row = { path: string; label: string; value: string; muted: boolean; source: string; mark: ReturnType<typeof markFor>; asking: boolean; review: boolean };

/** Counts for the summary header and the mobile peek bar. */
function useSummary() {
  const { ws } = useWs();
  const asking = new Set(currentPaths(ws));
  const paths = new Set<string>([...Object.keys(ws.profile.confirmed), ...Object.keys(ws.profile.conflicts), ...ws.profile.proposed.map((f) => f.fieldPath), ...asking]);
  const groups = new Map<Topic, Row[]>();
  for (const path of paths) {
    const topic = topicOf(path);
    if (!topic) continue;
    const isAsking = asking.has(path) && !ws.profile.confirmed[path] && !ws.profile.conflicts[path];
    const mark = isAsking ? ({ kind: "current" } as const) : markFor(ws, path);
    const v = valueFor(ws, path);
    groups.set(topic, [
      ...(groups.get(topic) ?? []),
      { path, label: labelFor(path), value: v.text, muted: v.muted, source: isAsking ? "Current question" : sourceFor(ws, path), mark, asking: isAsking, review: mark.kind === "review" || mark.kind === "conflict" },
    ]);
  }
  const ordered = TOPIC_ORDER.filter((t) => groups.has(t)).map((t) => ({ topic: t, rows: groups.get(t)!.sort((a, b) => fieldOrder(a.path) - fieldOrder(b.path) || a.path.localeCompare(b.path)) }));
  const all = ordered.flatMap((g) => g.rows);
  const review = all.filter((r) => r.review).length;
  const confirmed = Object.keys(ws.profile.confirmed).filter((p) => !all.find((r) => r.path === p)?.review).length;
  return { groups: ordered, counts: { confirmed, review, suggested: ws.profile.proposed.length } };
}

function CountsLine({ counts, className }: { counts: ReturnType<typeof useSummary>["counts"]; className?: string }) {
  const parts = [
    <span key="c" className="text-ok">✓ {counts.confirmed} confirmed</span>,
    counts.review > 0 && <span key="r" className="text-warn">⚠︎ {counts.review} {counts.review === 1 ? "needs" : "need"} review</span>,
    counts.suggested > 0 && <span key="s" className="text-est">◐ {counts.suggested} suggested</span>,
  ].filter(Boolean);
  return (
    <span className={cx("text-xs text-ink-secondary", className)}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </span>
  );
}

/** Topic groups of traced rows plus the readiness footer. `touch` uses the 14px mobile sizes. */
function SummaryBody({ touch }: { touch?: boolean }) {
  const { ws, changed } = useWs();
  const { groups } = useSummary();
  const px = touch ? "px-4" : "px-5";
  return (
    <>
      {groups.length === 0 ? (
        <p className={cx("py-4 text-[13px] text-muted", px)}>Nothing recorded yet. Answers and confirmed facts appear here as the interview goes.</p>
      ) : (
        groups.map((g) => (
          <section key={g.topic} aria-label={TOPIC_LABELS[g.topic]}>
            <h3 className={cx("pt-3 pb-1 text-xs font-medium text-muted", px)}>{TOPIC_LABELS[g.topic]}</h3>
            <dl>
              {g.rows.map((r) => (
                <div
                  key={r.path}
                  className={cx(
                    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3",
                    px,
                    touch ? "py-2" : "py-[7px]",
                    r.asking ? "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]" : r.review ? "bg-warn-wash shadow-[inset_2px_0_0_var(--color-warn)]" : "bg-surface",
                  )}
                >
                  <dt className={cx("text-ink-secondary", touch ? "text-sm" : "text-[13px]")}>{r.label}</dt>
                  <dd className={cx("num text-right font-medium", touch ? "text-sm" : "text-[13px]", r.muted ? "text-muted" : "text-ink", changed.has(r.path) && "just-changed rounded px-1")}>
                    {r.value}
                    {changed.has(r.path) && <span className="sr-only"> (just updated)</span>}
                  </dd>
                  <dd className={cx("text-muted", touch ? "text-xs" : "text-[11px]")}>{r.source}</dd>
                  <dd className="text-right">
                    <Mark kind={r.mark.kind} label={r.mark.label} small={!touch} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
      {ws.readiness.length > 0 && (
        <div className={cx("mt-2 flex flex-col gap-1.5 border-t border-line bg-subtle py-3.5", px)}>
          <h3 className="text-xs font-medium text-muted">What can be assessed now</h3>
          <ul className="flex flex-col gap-1.5">
            {ws.readiness.map((r) =>
              r.status === "ready" ? (
                <li key={r.output} className="text-xs text-ok">
                  <span aria-hidden="true">✓ </span>
                  {r.label}
                  <span className="sr-only"> — ready</span>
                </li>
              ) : (
                <li key={r.output} className="text-xs text-warn">
                  <span aria-hidden="true">⚠︎ </span>
                  {r.label}
                  <span className="sr-only"> — {r.status === "partial" ? "partly ready" : "not ready"}</span>
                  {r.summary && <span> — {r.summary}</span>}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </>
  );
}

/** CON06/CON07: "Client summary" aside beside the conversation (desktop). */
export function LivePanel() {
  const { counts } = useSummary();
  return (
    <section id="live-summary" aria-label="Client summary" className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-col gap-1 border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Client summary</h2>
        <CountsLine counts={counts} />
      </header>
      <SummaryBody />
    </section>
  );
}

/** Mobile: a peek bar pinned to the bottom that opens the summary as a bottom sheet. */
export function SummaryPeek() {
  const { counts } = useSummary();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="sticky bottom-0 z-20 flex h-14 w-full items-center gap-2 border-t border-line bg-subtle px-4 pb-2 text-left text-sm shadow-[0_-6px_16px_rgba(21,24,28,0.06)] lg:hidden"
      >
        <span className="font-semibold text-ink">Summary</span>
        <span className="text-ok">✓ {counts.confirmed}</span>
        {counts.review > 0 && <span className="text-warn">⚠︎ {counts.review} to review</span>}
        {counts.suggested > 0 && <span className="text-est">◐ {counts.suggested}</span>}
        <span className="flex-1" />
        <span aria-hidden="true" className="text-ink-secondary">▴</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(21,24,28,0.45)] lg:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Client summary" className="flex max-h-[85vh] flex-col overflow-hidden rounded-t-xl bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center p-2">
              <span aria-hidden="true" className="h-1 w-9 rounded-sm bg-line-strong" />
            </div>
            <div className="flex items-center gap-2 border-b border-line px-4 pt-1 pb-3">
              <h2 className="flex-1 text-base font-semibold">Client summary</h2>
              <span className="text-[13px] text-ink-secondary">
                ✓ {counts.confirmed}
                {counts.review > 0 && ` · ⚠︎ ${counts.review}`}
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close summary" autoFocus className="flex h-11 w-11 items-center justify-center text-lg text-ink-secondary">
                ×
              </button>
            </div>
            <div className="overflow-y-auto pb-6">
              <SummaryBody touch />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
