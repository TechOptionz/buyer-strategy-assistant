"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, CASE_STATUS, CaseStatusBadge, cx, Mark, ReportStatusBadge, SidePanel, Skeleton, Traced, type MarkKind } from "@/components/ui";
import { pinStore } from "@/components/shell/pins";
import { api } from "@/lib/client/api";
import { date, dateTime, money, moneyShort, relative } from "@/lib/format";
import type { ScenarioResult } from "@/lib/finance/types";
import { labelFor } from "@/lib/profile/fields";
import type { CaseListStatus, CaseView, listAssessments, Workspace } from "@/lib/services/assessments";
import { NewCaseDialog, type EntryMode } from "./NewCaseButton";

type Item = Awaited<ReturnType<typeof listAssessments>>["items"][number];
type Counts = Awaited<ReturnType<typeof listAssessments>>["counts"];

const PURPOSE: Record<string, string> = { ppor: "Home", investment: "Investment", undecided: "Undecided" };
const FINANCE: Record<string, { text: string; cls: string }> = {
  confirmed: { text: "✓ Confirmed", cls: "text-ok" },
  not_confirmed: { text: "⚠︎ Not confirmed", cls: "text-warn" },
  not_provided: { text: "— Not provided", cls: "text-muted" },
};
const STRIP: { key: CaseListStatus | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "draft", label: "In progress" },
  { key: "needs_clarification", label: "Needs clarification" },
  { key: "ready_for_review", label: "Ready for review" },
  { key: "needs_changes", label: "Changes requested" },
  { key: "reviewed", label: "Reviewed" },
];
const VIEWS: { value: CaseView; label: string }[] = [
  { value: "all", label: "All cases" },
  { value: "mine", label: "My cases" },
  { value: "review", label: "Ready for my review" },
];
const GRID = "grid grid-cols-[250px_190px_120px_130px_minmax(0,1fr)_100px_96px] gap-3";

export function CaseList({
  items,
  total,
  counts,
  page,
  pageSize,
  filters,
  canCreate,
  start,
  reviewers,
}: {
  items: Item[];
  total: number;
  counts: Counts;
  page: number;
  pageSize: number;
  filters: { q: string; status: CaseListStatus | null; view: CaseView };
  canCreate: boolean;
  start: EntryMode | null;
  reviewers: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [dialog, setDialog] = useState<{ open: boolean; mode: EntryMode }>({ open: !!start, mode: start ?? "notes" });
  const previewId = params.get("preview");

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const hasFilters = !!(filters.q || filters.status || filters.view !== "all");
  const totalAll = counts.all;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstRun = totalAll === 0 && !hasFilters;

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[22px] font-semibold">{filters.view === "review" ? "Ready for my review" : "Cases"}</h1>
        {canCreate && (
          <>
            <Button className="hidden sm:inline-flex" onClick={() => setDialog({ open: true, mode: "notes" })}>
              Paste meeting notes
            </Button>
            <Button variant="primary" onClick={() => setDialog({ open: true, mode: "guided" })}>
              New case
            </Button>
          </>
        )}
      </div>

      {!firstRun && (
        <>
          {/* FilterBar */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="case-view" className="sr-only">
              Saved view
            </label>
            <select
              id="case-view"
              value={filters.view}
              onChange={(e) => go({ view: e.target.value === "all" ? null : e.target.value })}
              className="h-8 rounded border border-line-strong bg-surface pr-7 pl-2.5 text-[13px] font-medium"
            >
              {VIEWS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                go({ q: q.trim() || null });
              }}
              className="w-full sm:w-[260px]"
            >
              <label htmlFor="case-search" className="sr-only">
                Search cases
              </label>
              <input
                id="case-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search client name"
                className="h-8 w-full rounded border border-line-strong bg-surface px-2.5 text-[13px] placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-offset-1 focus:outline-accent"
              />
            </form>
            {filters.status ? (
              <FilterChip active onRemove={() => go({ status: null })}>
                Status: {statusLabel(filters.status)}
              </FilterChip>
            ) : (
              <StatusMenu onPick={(s) => go({ status: s })} />
            )}
            {filters.q && (
              <FilterChip
                active
                onRemove={() => {
                  setQ("");
                  go({ q: null });
                }}
              >
                Client: {filters.q}
              </FilterChip>
            )}
            {hasFilters && (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => {
                  setQ("");
                  router.push(pathname);
                }}
              >
                Clear filters
              </button>
            )}
            <span className="flex-1" />
            <span className="hidden text-[13px] text-ink-secondary sm:inline">Sort: Last updated</span>
          </div>

          {/* Clickable status counts */}
          <div className="-mx-4 flex gap-5 overflow-x-auto border-b border-line px-4 pt-1 md:mx-0 md:gap-8 md:px-0">
            {STRIP.map((s) => {
              const on = (filters.status ?? null) === s.key;
              const n = s.key ? counts[s.key] : counts.all;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => go({ status: s.key })}
                  aria-pressed={on}
                  className={cx("-mb-px flex shrink-0 flex-col gap-0.5 border-b-2 pb-2 text-left", on ? "border-accent" : "border-transparent hover:border-line-strong")}
                >
                  <span className="text-xs whitespace-nowrap text-ink-secondary">{s.label}</span>
                  <span className="text-lg font-semibold md:text-[22px]">{n}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {firstRun ? (
        <div className="flex min-h-[340px] flex-col justify-center gap-4 rounded-lg border border-line bg-surface p-8 md:p-12">
          <h2 className="text-lg font-semibold">No cases yet</h2>
          <p className="max-w-[460px] text-sm leading-relaxed text-ink-secondary">
            Start from a client meeting. Paste your notes and the app proposes facts for you to confirm, or answer one question at a time.
          </p>
          {canCreate && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setDialog({ open: true, mode: "notes" })}>
                Paste meeting notes
              </Button>
              <Button onClick={() => setDialog({ open: true, mode: "guided" })}>Start guided interview</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <div className="hidden min-w-[1080px] md:block">
              <div className={cx(GRID, "h-8 items-center border-b border-line bg-subtle px-4 text-xs font-medium text-muted")} role="row">
                <span>Client</span>
                <span>Status</span>
                <span className="text-right">Target price</span>
                <span>Finance</span>
                <span>Next step</span>
                <span>Owner</span>
                <span className="text-right">Updated ↓</span>
              </div>
              {items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => go({ preview: r.id, page: String(page) })}
                  aria-label={`Preview ${r.buyerDisplayName}`}
                  className={cx(
                    GRID,
                    "h-12 w-full items-center border-b border-line-soft px-4 text-left text-[13px] last:border-b-0",
                    previewId === r.id ? "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]" : "hover:bg-hover",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{r.buyerDisplayName}</span>
                    <span className="truncate text-xs text-muted">{subLine(r)}</span>
                  </span>
                  <span>
                    <CaseStatusBadge status={r.badgeStatus} />
                  </span>
                  <span className={cx("text-right font-medium", r.targetPriceCents == null && "text-muted")}>{moneyShort(r.targetPriceCents)}</span>
                  <span className={cx("text-xs", FINANCE[r.finance].cls)}>{FINANCE[r.finance].text}</span>
                  <span className={cx("truncate", r.nextStep.attention ? "text-warn" : "text-ink-secondary")}>{r.nextStep.text}</span>
                  <span className="truncate text-ink-secondary">{r.agentName}</span>
                  <span className="text-right text-ink-secondary" title={dateTime(r.updatedAt)}>
                    {relative(r.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Mobile: stacked two-line rows */}
          <ul className="md:hidden">
            {items.map((r) => (
              <li key={r.id} className="border-b border-line-soft last:border-b-0">
                <button type="button" onClick={() => go({ preview: r.id, page: String(page) })} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left">
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[15px] font-medium">{r.buyerDisplayName}</span>
                    <CaseStatusBadge status={r.badgeStatus} />
                  </span>
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className={cx("font-medium", r.targetPriceCents == null && "text-muted")}>{moneyShort(r.targetPriceCents)}</span>
                    <span className="text-line-strong">·</span>
                    <span className={cx("flex-1 truncate", r.nextStep.attention ? "text-warn" : "text-ink-secondary")}>{r.nextStep.text}</span>
                    <span className="text-muted">{relative(r.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="text-sm font-medium">No cases match {describeFilters(filters)}</span>
              <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => router.push(pathname)}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flex h-11 items-center gap-3 border-t border-line px-4 text-xs text-ink-secondary">
              <span className="flex-1">
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} case{total === 1 ? "" : "s"}
              </span>
              {page > 1 ? (
                <button type="button" className="text-accent hover:underline" onClick={() => go({ page: String(page - 1) })}>
                  ‹ Previous
                </button>
              ) : (
                <span className="text-faint">‹ Previous</span>
              )}
              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
                .map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => go({ page: String(n) })}
                    aria-current={n === page ? "page" : undefined}
                    className={cx("inline-flex h-7 w-7 items-center justify-center rounded", n === page ? "border border-line-strong font-medium text-ink" : "hover:bg-hover")}
                  >
                    {n}
                  </button>
                ))}
              {page < pages ? (
                <button type="button" className="text-accent hover:underline" onClick={() => go({ page: String(page + 1) })}>
                  Next ›
                </button>
              ) : (
                <span className="text-faint">Next ›</span>
              )}
            </div>
          )}
        </div>
      )}

      <CasePreview id={previewId} item={items.find((i) => i.id === previewId) ?? null} onClose={() => go({ preview: null, page: String(page) })} />
      <NewCaseDialog open={dialog.open} mode={dialog.mode} reviewers={reviewers} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
    </div>
  );
}

function statusLabel(s: CaseListStatus) {
  return STRIP.find((x) => x.key === s)?.label ?? CASE_STATUS[s].label;
}

function subLine(r: Item) {
  const purpose = r.purpose ? PURPOSE[r.purpose] : "Undecided";
  return `${purpose} · ${r.areas.length ? r.areas.join(", ") : "—"}`;
}

function describeFilters(f: { q: string; status: CaseListStatus | null; view: CaseView }) {
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  if (f.status) parts.push(`Status: ${statusLabel(f.status)}`);
  if (f.view !== "all") parts.push(VIEWS.find((v) => v.value === f.view)!.label);
  return parts.join(" with ") || "these filters";
}

function FilterChip({ children, active, onRemove }: { children: React.ReactNode; active?: boolean; onRemove?: () => void }) {
  return (
    <span className={cx("inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs", active ? "border border-accent-line bg-accent-tint font-medium text-accent" : "border border-dashed border-line-strong text-ink-secondary")}>
      {children}
      {onRemove && (
        <button type="button" aria-label="Remove filter" onClick={onRemove} className="text-sm leading-none">
          ×
        </button>
      )}
    </span>
  );
}

function StatusMenu({ onPick }: { onPick: (s: CaseListStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} className="inline-flex h-7 items-center rounded border border-dashed border-line-strong px-2 text-xs text-ink-secondary hover:bg-hover">
        + Status
      </button>
      {open && (
        <ul role="menu" className="absolute top-8 left-0 z-20 w-56 rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-overlay)]">
          {STRIP.filter((s) => s.key).map((s) => (
            <li key={s.key}>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left hover:bg-hover"
                onClick={() => {
                  setOpen(false);
                  onPick(s.key!);
                }}
              >
                <CaseStatusBadge status={s.key!} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────────── Preview panel ─────────────────────────────── */

function CasePreview({ id, item, onClose }: { id: string | null; item: Item | null; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ id: string; ws?: Workspace; error?: string } | null>(null);
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.get, pinStore.server);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api<Workspace>(`/api/assessments/${id}`).then(
      (ws) => !cancelled && setData({ id, ws }),
      (e: unknown) => !cancelled && setData({ id, error: e instanceof Error ? e.message : "Couldn’t load this case" }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = data && data.id === id ? data : null;
  const ws = current?.ws;
  const name = ws?.assessment.buyerDisplayName ?? item?.buyerDisplayName ?? "Case";

  return (
    <SidePanel
      open={!!id}
      onClose={onClose}
      label="Case preview"
      footer={
        id && (
          <>
            <Button variant="primary" onClick={() => router.push(`/cases/${id}`)}>
              Open case
            </Button>
            <Button onClick={() => pinStore.toggle(id)} aria-pressed={pins.includes(id)}>
              {pins.includes(id) ? "Unpin" : "Pin"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-2 border-b border-line px-4 pt-2 pb-4 md:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold">{name}</h2>
          {item && <CaseStatusBadge status={item.badgeStatus} />}
        </div>
        {item && <span className="text-[13px] text-ink-secondary">{subLine(item)}</span>}
        <span className="text-xs text-ink-secondary">
          Indicative only — not loan approval
          {item?.finance !== "confirmed" && (
            <>
              {" · "}
              <span className="text-warn">⚠︎ Finance not confirmed</span>
            </>
          )}
        </span>
      </div>
      <div className="flex flex-col px-4 py-4 md:px-6">
        {!current && (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="w-3/5" />
            <Skeleton className="w-4/5" />
            <Skeleton className="w-2/5" />
            <span className="text-xs text-muted">Loading case…</span>
          </div>
        )}
        {current?.error && <p className="text-[13px] text-bad">⚠︎ {current.error}</p>}
        {ws && <PreviewBody ws={ws} />}
      </div>
    </SidePanel>
  );
}

function PreviewBody({ ws }: { ws: Workspace }) {
  const c = ws.profile.confirmed;
  const val = (p: string) => (c[p]?.state === "value" ? (c[p].value as number) : null);
  const base = ws.scenarios.filter((s) => s.kind === "base").at(-1) ?? ws.scenarios[0];
  const r = base ? (base.result as ScenarioResult) : null;
  const stale = !!base?.staleBecause.length;
  const finOk = ["pre_approval", "formal_approval"].includes(String(c["finance.confirmationStatus"]?.value ?? ""));
  const calcMark = (v: number | null): { kind: MarkKind; label?: string } => (v == null ? { kind: "missing", label: "Incomplete" } : stale ? { kind: "stale" } : { kind: "calculated" });
  const rows: { label: string; value: string; source: string; mark: { kind: MarkKind; label?: string } }[] = [
    { label: "Target price", value: money(val("scenario.targetPrice")), source: c["scenario.targetPrice"] ? `Assumption · ${date(c["scenario.targetPrice"].confirmedAt)}` : "Not yet asked", mark: c["scenario.targetPrice"] ? { kind: "assumption" } : { kind: "notasked" } },
    {
      label: "Funding available",
      value: money(r?.funding.availableFundingCents),
      source: r ? `Calculated${val("funds.protectedReserve") != null ? ` · excl. ${money(val("funds.protectedReserve"))} reserve` : ""}` : "No scenario yet",
      mark: calcMark(r?.funding.availableFundingCents ?? null),
    },
    { label: "Cash required at settlement", value: money(r?.funding.cashRequiredCents), source: r ? `Calculated · engine v${base!.calculationVersion}` : "No scenario yet", mark: calcMark(r?.funding.cashRequiredCents ?? null) },
    {
      label: base?.inputs && (base.inputs as { purpose?: string }).purpose === "ppor" ? "Annual ownership cost" : "Annual cashflow",
      value:
        base?.inputs && (base.inputs as { purpose?: string }).purpose === "ppor"
          ? `${money(r?.cashflow.annualOwnershipCostCents)}${r?.cashflow.annualOwnershipCostCents != null ? "/yr" : ""}`
          : `${money(r?.cashflow.annualIncrementalCashflowCents)}${r?.cashflow.annualIncrementalCashflowCents != null ? "/yr" : ""}`,
      source: r ? "Base scenario · before tax" : "No scenario yet",
      mark: calcMark(r?.cashflow.annualIncrementalCashflowCents ?? r?.cashflow.annualOwnershipCostCents ?? null),
    },
    {
      label: "Borrowing limit",
      value: money(val("finance.borrowingLimit")),
      source: c["finance.borrowingLimit"] ? [c["finance.limitSource"]?.value as string | undefined, c["finance.limitDate"]?.value ? date(c["finance.limitDate"].value as string) : null].filter(Boolean).join(" · ") || "Client-supplied" : "Not yet asked",
      mark: c["finance.borrowingLimit"] ? (finOk ? { kind: "confirmed" } : { kind: "notconfirmed" }) : { kind: "notasked" },
    },
  ];
  const conflicts = Object.keys(ws.profile.conflicts);
  const issues: string[] = [
    ...conflicts.map((p) => {
      const facts = ws.profile.conflicts[p];
      return `${labelFor(p)}: ${facts.length} values disagree`;
    }),
    ...(c["finance.borrowingLimit"] && !finOk ? ["Borrowing limit not confirmed by lender or broker"] : []),
    ...(ws.profile.proposed.length ? [`${ws.profile.proposed.length} suggested fact${ws.profile.proposed.length > 1 ? "s" : ""} to confirm`] : []),
    ...(stale ? ["Base scenario is out of date — recalculate"] : []),
  ];
  const report = ws.reports[0];
  return (
    <>
      {rows.map((row) => (
        <Traced key={row.label} label={row.label} value={row.value} muted={row.value === "—"} source={row.source} mark={<Mark kind={row.mark.kind} label={row.mark.label} />} className="border-b border-line-soft py-2.5" />
      ))}
      {issues.length > 0 && (
        <>
          <div className="mt-5 mb-2 text-xs font-medium text-muted">Open issues · {issues.length}</div>
          <div className="flex flex-col gap-2">
            {issues.map((t) => (
              <div key={t} className="flex gap-2 rounded border border-warn-line bg-warn-tint px-3 py-2.5 text-[13px] text-warn-ink">
                <span aria-hidden="true" className="text-warn">
                  ⚠︎
                </span>
                <span className="flex-1">{t}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="mt-5 mb-2 text-xs font-medium text-muted">Report</div>
      {report ? (
        <div className="flex items-center gap-2 text-[13px]">
          <ReportStatusBadge status={report.status} />
          <span className="text-ink-secondary">
            v{report.version} · generated {date(report.createdAt)}
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-ink-secondary">No report drafted yet</span>
      )}
    </>
  );
}
