"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button, cx, human, Modal, ReportStatusBadge, Spinner } from "@/components/ui";
import { date, dateTime } from "@/lib/format";
import { useWs } from "../context";
import { type CheckItem, editableStatus, type ExportState, type FullReport, isReviewed, kb, type ReviewAction, shortHash } from "./model";

type VersionRow = { id: string; version: number; status: string; createdAt: string; reviewedAt: string | null; changeSummary: string | null };

export interface ReviewPanelProps {
  report: FullReport;
  versions: VersionRow[];
  selId: string | null;
  onSelectVersion: (id: string) => void;
  items: CheckItem[];
  accepted: string[];
  onAccept: (id: string, on: boolean) => void;
  currentId: string | null;
  onFocusItem: (id: string) => void;
  onNext: () => void;
  canEdit: boolean;
  canReview: boolean;
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onReview: (a: ReviewAction, comment?: string) => Promise<boolean>;
  exp: ExportState | null;
  onExport: () => void;
  onNewVersion: () => void;
  onReplace: () => void;
  latest: string | null;
  reviewerName: string | null;
}

const VERSION_STATUS: Record<string, { icon: string; cls: string; label: string }> = {
  draft: { icon: "○", cls: "text-neutral", label: "Draft" },
  ready_for_review: { icon: "→", cls: "text-accent", label: "Ready for review" },
  needs_changes: { icon: "↺", cls: "text-warn", label: "Changes requested" },
  reviewed: { icon: "✓", cls: "text-ok", label: "Reviewed" },
  superseded: { icon: "", cls: "text-muted line-through", label: "Superseded" },
};

function VersionList({ versions, selId, onSelect }: { versions: VersionRow[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col">
      {versions.map((v) => {
        const s = VERSION_STATUS[v.status] ?? VERSION_STATUS.draft;
        const sel = v.id === selId;
        return (
          <li key={v.id}>
            <button
              type="button"
              aria-current={sel ? "true" : undefined}
              onClick={() => onSelect(v.id)}
              className={cx("flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover", sel && "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]", v.status === "superseded" && "text-muted")}
            >
              <span className="flex w-full items-center gap-2">
                <span className="w-7 font-medium">v{v.version}</span>
                <span className={cx("flex-1 text-xs font-medium", s.cls)}>
                  {s.icon && <span aria-hidden="true">{s.icon} </span>}
                  {s.label}
                </span>
                <span className="text-xs text-muted">{date(v.reviewedAt ?? v.createdAt)}</span>
              </span>
              {v.changeSummary && <span className="pl-9 text-xs text-muted">{v.changeSummary}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function MenuItem({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className="flex h-9 w-full items-center px-3 text-left text-[13px] text-ink hover:bg-hover disabled:text-faint">
      {children}
    </button>
  );
}

function CheckRow({ item, accepted, current, canAccept, onAccept, onFocus }: { item: CheckItem; accepted: boolean; current: boolean; canAccept: boolean; onAccept: (on: boolean) => void; onFocus: () => void }) {
  const warn = item.state === "warn" && !accepted;
  return (
    <li
      className={cx(
        "-mx-2.5 flex items-start gap-2.5 rounded px-2.5 py-2 text-[13px]",
        current && warn && "bg-warn-wash shadow-[inset_2px_0_0_var(--color-warn)]",
      )}
    >
      <span aria-hidden="true" className={cx("w-3.5 flex-none", warn ? "text-warn" : "text-ok")}>
        {warn ? "⚠︎" : "✓"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {item.page ? (
          <button type="button" onClick={onFocus} className="text-left text-ink hover:underline">
            {item.text}
            <span className="sr-only">{warn ? " (open warning, show in preview)" : " (show in preview)"}</span>
          </button>
        ) : (
          <span>{item.text}</span>
        )}
        <span className="text-xs text-muted">{accepted ? `Accepted · ${item.acceptAs ?? item.text}` : item.sub}</span>
      </div>
      {item.state === "warn" && canAccept && (
        <button type="button" onClick={() => onAccept(!accepted)} className="text-xs font-medium whitespace-nowrap text-accent hover:text-accent-hover hover:underline">
          {accepted ? "Undo" : "Accept"}
          <span className="sr-only">: {item.text}</span>
        </button>
      )}
    </li>
  );
}

export function ReviewPanel(p: ReviewPanelProps) {
  const { report, items, accepted, currentId } = p;
  const s = report.status;
  const uid = useId();
  const { ws } = useWs();
  const versions = usePopover();
  const mVersions = usePopover();
  const menu = usePopover();
  const mMenu = usePopover();
  const [reqOpen, setReqOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [reqError, setReqError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const canAccept = p.canReview && s === "ready_for_review";
  const warnings = items.filter((i) => i.state === "warn");
  const open = warnings.filter((w) => !accepted.includes(w.id));
  const done = items.length - open.length;
  const current = open.find((w) => w.id === currentId) ?? open[0] ?? null;
  const nextPos = current ? (open.indexOf(current) + 1) % open.length : 0;
  const reviewed = isReviewed(s);
  const running = p.exp?.phase === "running";
  const exportLabel = reviewed ? "Export PDF" : "Export draft PDF";

  async function run(action: ReviewAction, c?: string) {
    setBusy(true);
    const ok = await p.onReview(action, c);
    setBusy(false);
    return ok;
  }

  async function approve() {
    const acc = warnings.filter((w) => accepted.includes(w.id)).map((w) => w.acceptAs ?? w.text);
    const text = acc.length ? `Accepted: ${acc.join("; ")}` : undefined;
    await run("approve", text && text.length > 2000 ? `${text.slice(0, 1997)}…` : text);
  }

  async function submitRequest() {
    if (!comment.trim()) {
      setReqError("Add a comment to request changes");
      return;
    }
    setReqError(undefined);
    const ok = await run("request_changes", comment.trim());
    if (ok) {
      setComment("");
      setReqOpen(false);
    }
  }

  /* ---------------- shared pieces ---------------- */

  const header = (v: ReturnType<typeof usePopover>) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <ReportStatusBadge status={s} />
        <span className="text-[13px] font-medium">
          v{report.version}
          {reviewed ? " · locked" : ""}
        </span>
        <span className="flex-1" />
        <div ref={v.ref} className="relative">
          <button type="button" aria-expanded={v.open} aria-haspopup="true" onClick={() => v.setOpen(!v.open)} className="text-xs text-accent hover:text-accent-hover hover:underline">
            Versions ({p.versions.length})
          </button>
          {v.open && (
            <div className="absolute top-6 right-0 z-30 flex w-[320px] max-w-[85vw] flex-col gap-1 rounded-lg border border-line bg-surface p-2 shadow-[var(--shadow-overlay)]">
              <span className="px-2 pt-1 pb-1.5 text-xs text-muted">Reviewed versions are frozen. Later changes create a new version.</span>
              <VersionList
                versions={p.versions}
                selId={p.selId}
                onSelect={(id) => {
                  v.setOpen(false);
                  p.onSelectVersion(id);
                }}
              />
            </div>
          )}
        </div>
      </div>
      {reviewed && report.reviewedAt ? (
        <span className="text-xs text-ink-secondary">
          {p.reviewerName ?? "Reviewer"} · {dateTime(report.reviewedAt)} · Snapshot {shortHash(report.snapshotHash)}
        </span>
      ) : null}
      <span className="text-xs text-muted">
        Generated {dateTime(report.snapshot.generatedAt)} · Snapshot {shortHash(report.snapshotHash)}
      </span>
      {p.latest && <span className="text-xs text-ink-secondary">Latest: {p.latest}</span>}
      {report.changeSummary && <span className="text-xs text-muted">Changes: {report.changeSummary}</span>}
    </div>
  );

  const exportBlock = () => {
    const exp = p.exp;
    const exports = [...report.exports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const href = (id: string) => `/api/reports/${report.id}/pdf?export=${id}`;
    if (!exp && !exports.length) return null;
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Export</span>
        {exp?.phase === "running" && <Spinner label={`Exporting — ${human(exp.status)}`} />}
        {exp?.phase === "done" && exp.exportId && (
          <Alert
            tone="ok"
            title="PDF ready"
            action={
              <a href={href(exp.exportId)} download className="text-[13px] font-medium">
                Download PDF
              </a>
            }
          >
            v{report.version} · {reviewed ? "Reviewed" : "Draft, watermarked"}
          </Alert>
        )}
        {exp?.phase === "failed" && (
          <Alert
            tone="bad"
            title="Export failed"
            action={
              <Button size="xs" onClick={p.onExport}>
                Retry
              </Button>
            }
          >
            {exp.error}
          </Alert>
        )}
        {exp?.phase === "denied" && (
          <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
            <span className="text-sm font-medium">You can’t export this report</span>
            <span className="text-[13px] leading-normal text-ink-secondary">{exp.error ?? "Your role can review and comment. Export needs agent access to this case."}</span>
          </div>
        )}
        {p.dirty && <span className="text-xs text-warn">⚠︎ Unsaved edits are not included in the export.</span>}
        {exports.length > 0 && (
          <ul className="flex flex-col">
            {exports.map((e) => (
              <li key={e.id} className="flex items-center gap-2 border-b border-line-soft py-1.5 text-xs">
                <span className="flex-1 text-ink-secondary">
                  {dateTime(e.createdAt)} · {kb(e.byteSize)}
                </span>
                <a href={href(e.id)} download className="font-medium">
                  Download<span className="sr-only"> export from {dateTime(e.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const assumptions = (() => {
    const snap = report.snapshot;
    const rows: { label: string; value: string; source: string; mark: string; cls: string }[] = [];
    const topic = snap.profile.find((t) => t.topic === "Scenario assumptions");
    for (const it of topic?.items ?? []) rows.push({ label: it.label, value: it.value, source: `Profile · revision ${snap.profileRevision}`, mark: "○ Assumption", cls: "text-neutral" });
    const base = snap.scenarios[0];
    for (const l of (base?.labels ?? []).filter((x) => /assum|estimat/i.test(x) && !/\(confirmed\)/i.test(x)).slice(0, 6)) {
      const est = /estimat/i.test(l);
      rows.push({ label: l.replace(/^Assumption:\s*/, ""), value: "", source: base!.name, mark: est ? "◐ Estimated" : "○ Assumption", cls: est ? "text-est" : "text-neutral" });
    }
    return rows;
  })();

  const body = (
    <>
      {s === "needs_changes" && report.reviewComment && (
        <Alert tone="warn" title="Reviewer requested changes" icon="↺">
          {report.reviewComment}
        </Alert>
      )}

      <div className="flex flex-col">
        <div className="mb-1.5 flex items-baseline">
          <span className="flex-1 text-[13px] font-semibold">Checklist</span>
          <span className="text-xs text-ink-secondary">
            {done} of {items.length} done
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {items.map((it) => (
            <CheckRow
              key={it.id}
              item={it}
              accepted={accepted.includes(it.id)}
              current={current?.id === it.id}
              canAccept={canAccept}
              onAccept={(on) => p.onAccept(it.id, on)}
              onFocus={() => p.onFocusItem(it.id)}
            />
          ))}
        </ul>
      </div>

      {open.length > 0 && (
        <Button className="w-full" onClick={p.onNext}>
          Review next item · {nextPos + 1} of {open.length} →
        </Button>
      )}

      {exportBlock()}

      {reviewed && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Version history</span>
          <VersionList versions={p.versions} selId={p.selId} onSelect={p.onSelectVersion} />
        </div>
      )}

      <div className="flex flex-col">
        <span className="mb-1.5 text-[13px] font-semibold">Assumptions in this report</span>
        {assumptions.length ? (
          assumptions.map((a, i) => (
            <div key={`${a.label}-${i}`} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line-soft py-1.5">
              <span className="text-[13px] text-ink-secondary">{a.label}</span>
              <span className="num text-right text-[13px] font-medium">{a.value}</span>
              <span className="text-[11px] text-muted">{a.source}</span>
              <span className={cx("text-right text-[11px] font-medium", a.cls)}>{a.mark}</span>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted">No scenario assumptions in this report.</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Scope</span>
        <span className="text-xs text-ink-secondary">
          {(report.scope?.areaAssessment ?? report.snapshot.scope.areaAssessment) ? "Area assessment included" : "Area assessment not included"} ·{" "}
          {(report.scope?.purchaseBudget ?? report.snapshot.scope.purchaseBudget) ? "Purchase-budget conclusion included" : "Purchase-budget conclusion excluded"} ·{" "}
          {report.narrativeSource === "ai" ? "Narrative AI-drafted, figures from saved values" : "Narrative from template"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Comments</span>
        {report.reviewComment && s !== "needs_changes" ? (
          <p className="text-[13px] whitespace-pre-line text-ink-2">{report.reviewComment}</p>
        ) : report.reviewComment ? (
          <span className="text-xs text-muted">See the reviewer’s request above.</span>
        ) : (
          <span className="text-xs text-muted">No comments on v{report.version}.</span>
        )}
      </div>
    </>
  );

  const moreMenu = (m: ReturnType<typeof usePopover>, big: boolean) => (
    <div ref={m.ref} className="relative">
      <Button aria-label="Other actions" aria-haspopup="menu" aria-expanded={m.open} onClick={() => m.setOpen(!m.open)} className={cx(big ? "h-12 w-12" : "w-9", "!px-0")}>
        ⋯
      </Button>
      {m.open && (
        <div role="menu" className="absolute right-0 bottom-full z-30 mb-1 w-[220px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-overlay)]">
          <MenuItem
            disabled={running}
            onClick={() => {
              m.setOpen(false);
              p.onExport();
            }}
          >
            {exportLabel}
          </MenuItem>
          {p.canEdit && editableStatus(s) && (
            <MenuItem
              disabled={p.dirty || busy}
              onClick={() => {
                m.setOpen(false);
                void run("submit");
              }}
            >
              Submit for review
            </MenuItem>
          )}
          {p.canEdit && editableStatus(s) && p.dirty && (
            <MenuItem
              onClick={() => {
                m.setOpen(false);
                p.onDiscard();
              }}
            >
              Discard unsaved edits
            </MenuItem>
          )}
          {p.canEdit && (
            <MenuItem
              onClick={() => {
                m.setOpen(false);
                p.onNewVersion();
              }}
            >
              New version…
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );

  const footer = (big: boolean, m: ReturnType<typeof usePopover>) => {
    const hasReviewer = !!ws.assessment.reviewerId;
    const h = big ? "h-12 text-[15px]" : "";
    let buttons: ReactNode = null;
    let note: ReactNode = null;
    if (editableStatus(s)) {
      if (p.canEdit) {
        buttons = p.dirty ? (
          <>
            <Button variant="primary" className={cx("flex-1", h)} onClick={p.onSave}>
              Save edits
            </Button>
            <Button className={h} onClick={p.onDiscard}>
              Discard
            </Button>
          </>
        ) : (
          <Button variant="primary" className={cx("flex-1", h)} disabled={busy} onClick={() => void run("submit")}>
            Submit for review
          </Button>
        );
        note = p.dirty ? (
          <span className="text-xs text-warn">● Unsaved commentary — save before submitting.</span>
        ) : !hasReviewer ? (
          <span className="text-xs text-warn">⚠︎ No reviewer is assigned to this case, so nobody can see it to review. Assign one in the case header (next to Finance) before submitting.</span>
        ) : (
          <span className="text-xs text-muted">Only commentary and next actions can be edited. Figures come from the saved snapshot.</span>
        );
      } else {
        note = <span className="text-xs text-muted">Draft in progress. Only the assigned agent can edit and submit it.</span>;
      }
    } else if (s === "ready_for_review") {
      if (p.canReview) {
        buttons = (
          <>
            <Button variant="primary" className={cx("flex-1", h)} disabled={busy || open.length > 0} aria-describedby={`${uid}-approve-note`} onClick={approve}>
              {big ? "Approve" : "Approve report"}
            </Button>
            <Button
              className={cx(big && "flex-1", h)}
              disabled={busy}
              onClick={() => {
                setReqError(undefined);
                setReqOpen(true);
              }}
            >
              Request changes
            </Button>
          </>
        );
        note =
          open.length > 0 ? (
            <span id={`${uid}-approve-note`} className="text-xs text-warn">
              ⚠︎ {open.length} warning{open.length === 1 ? "" : "s"} open — resolve or accept each to approve
            </span>
          ) : (
            <span id={`${uid}-approve-note`} className="text-xs text-muted">
              Approving freezes snapshot {shortHash(report.snapshotHash)} and records you, the time{warnings.length ? " and the accepted assumptions" : ""}.
            </span>
          );
      } else {
        note = <span className="text-xs text-muted">Awaiting review. It can’t be edited while in review.</span>;
      }
    } else if (s === "reviewed") {
      buttons = (
        <Button variant="primary" className={cx("flex-1", h)} disabled={running} onClick={p.onExport}>
          Export PDF
        </Button>
      );
      note = <span className="text-xs text-muted">Export downloads a file. Sharing with the client happens outside the app.</span>;
    } else if (s === "superseded") {
      note = <span className="text-xs text-muted">Superseded by a later reviewed version. Read-only — reproducible exactly as reviewed.</span>;
    }
    return (
      <div className={cx("flex flex-col gap-2 border-t border-line bg-surface", big ? "px-4 pt-3 pb-7" : "px-5 py-3.5")}>
        <div className="flex gap-2">
          {buttons ?? <span className="flex-1" />}
          {moreMenu(m, big)}
        </div>
        {note}
      </div>
    );
  };

  return (
    <>
      {/* Desktop: right review panel */}
      <aside aria-label="Review" className="hidden w-[380px] flex-none flex-col border-l border-line bg-surface lg:flex">
        <div className="border-b border-line px-5 py-4">{header(versions)}</div>
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-4">{body}</div>
        {footer(false, menu)}
      </aside>

      {/* Mobile: review bottom sheet */}
      <div role="region" aria-label="Review" className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85dvh] flex-col rounded-t-xl bg-surface shadow-[0_-8px_24px_rgba(21,24,28,0.12)] lg:hidden">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex justify-center p-2" aria-label={expanded ? "Collapse review panel" : "Expand review panel"}>
          <span className="h-1 w-9 rounded-sm bg-line-strong" />
        </button>
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-4 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[15px] font-semibold">
              Review · {done} of {items.length} done
            </span>
            {open.length > 0 && <span className="text-[13px] text-warn">⚠︎ {open.length} open</span>}
            <button type="button" onClick={() => setExpanded(!expanded)} className="text-[13px] text-accent">
              {expanded ? "Less" : "Details"}
            </button>
          </div>
          {expanded ? (
            <div className="flex flex-col gap-[18px]">
              {header(mVersions)}
              {body}
            </div>
          ) : (
            <>
              {current && (
                <div className="flex flex-col gap-1 rounded border border-warn-line bg-warn-tint p-3">
                  <button type="button" onClick={() => p.onFocusItem(current.id)} className="text-left text-sm font-medium">
                    {current.text}
                  </button>
                  <span className="text-xs text-warn-ink">{current.sub}</span>
                  {canAccept && (
                    <div className="mt-1.5 flex gap-2">
                      <Button size="lg" onClick={() => p.onAccept(current.id, true)}>
                        Accept
                      </Button>
                      {current.replaceable && p.canEdit && (
                        <Button size="lg" variant="tertiary" onClick={p.onReplace}>
                          Replace value
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {open.length > 1 && (
                <Button size="lg" onClick={p.onNext}>
                  Next item →
                </Button>
              )}
            </>
          )}
        </div>
        {footer(true, mMenu)}
      </div>

      <RequestChangesModal
        open={reqOpen}
        version={report.version}
        comment={comment}
        error={reqError}
        busy={busy}
        onComment={(v) => {
          setComment(v);
          if (reqError && v.trim()) setReqError(undefined);
        }}
        onCancel={() => setReqOpen(false)}
        onSubmit={submitRequest}
      />
    </>
  );
}

function RequestChangesModal({ open, version, comment, error, busy, onComment, onCancel, onSubmit }: { open: boolean; version: number; comment: string; error?: string; busy: boolean; onComment: (v: string) => void; onCancel: () => void; onSubmit: () => void }) {
  const id = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Request changes to v${version}`}
      width={380}
      footer={
        <>
          <Button variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={onSubmit}>
            Request changes
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-normal text-ink-secondary">The report returns to the agent as Changes requested. v{version} is kept for the record.</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">
          What needs to change? <span className="text-bad">Required</span>
        </label>
        <textarea
          id={id}
          value={comment}
          maxLength={2000}
          placeholder="Describe the change…"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onComment(e.target.value)}
          className={cx(
            "h-24 w-full rounded border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1",
            error ? "border-bad focus:outline-bad" : "border-line-strong focus:border-accent focus:outline-accent",
          )}
        />
        {error && (
          <span id={`${id}-error`} role="alert" className="text-xs text-bad">
            ⚠︎ {error}
          </span>
        )}
      </div>
    </Modal>
  );
}
