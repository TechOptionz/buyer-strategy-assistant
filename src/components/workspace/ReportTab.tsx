"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, cx, EmptyState, Modal, Skeleton, Spinner } from "@/components/ui";
import { api, ClientApiError, waitForJob } from "@/lib/client/api";
import { dateTime, date, time } from "@/lib/format";
import { useWs } from "./context";
import { CreateDraft } from "./report/CreateDraft";
import { ACTIVITY_VERB, type Action, buildChecklist, editableStatus, errMsg, type ExportState, type FullReport, isReviewed, pageDomId, type ReviewAction, rowDomId } from "./report/model";
import { type FlagFn, Paper } from "./report/Paper";
import { ReviewPanel } from "./report/ReviewPanel";

type Loaded = { id: string; nonce: number; report: FullReport; error?: undefined } | { id: string; nonce: number; report?: undefined; error: string };

interface Edits {
  key: string;
  commentary: Record<string, string>;
  actions: Action[] | null;
}

type ZoomMode = { mode: "auto" | "fit" } | { mode: "manual"; value: number };

export function ReportTab() {
  const { ws, mutate, setSave, goTab, notify } = useWs();
  const { canEdit, canReview } = ws.permissions;
  const reports = ws.reports;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selId = selectedId ?? reports[0]?.id ?? null;
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [edits, setEdits] = useState<Edits | null>(null);
  const [exp, setExp] = useState<ExportState | null>(null);
  const [accepted, setAccepted] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<ZoomMode>({ mode: "auto" });
  const [fitScale, setFitScale] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selId) return;
    let cancelled = false;
    api<FullReport>(`/api/reports/${selId}`).then(
      (report) => {
        if (!cancelled) setLoaded({ id: selId, nonce, report });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ id: selId, nonce, error: errMsg(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selId, nonce]);

  const current = loaded && loaded.id === selId ? loaded : null;
  const refreshing = !!current && current.nonce !== nonce;
  const report = current?.report ?? null;
  const reload = () => setNonce((n) => n + 1);

  const editKey = report ? `${report.id}:${report.rowVersion}` : "";
  const myEdits = edits && edits.key === editKey ? edits : null;
  const dirty =
    !!report &&
    !!myEdits &&
    (report.sections.sections.some((s) => myEdits.commentary[s.key] !== undefined && myEdits.commentary[s.key] !== s.commentary) ||
      (myEdits.actions !== null && JSON.stringify(myEdits.actions) !== JSON.stringify(report.sections.nextActions)));

  /* ---------------- review checklist (client-side acceptance) ---------------- */

  const items = useMemo(() => (report ? buildChecklist(report) : []), [report]);
  const acceptedIds = accepted.key === editKey ? accepted.ids : [];
  const warnings = items.filter((i) => i.state === "warn");
  const openWarnings = warnings.filter((w) => !acceptedIds.includes(w.id));
  const currentWarn = openWarnings.find((w) => w.id === currentId) ?? openWarnings[0] ?? null;

  const flag: FlagFn = (row) => {
    if (!report || isReviewed(report.status)) return undefined;
    const i = openWarnings.findIndex((w) => w.row === row);
    if (i < 0) return undefined;
    return { tag: `${i + 1}/${openWarnings.length}`, current: openWarnings[i].id === currentWarn?.id };
  };

  const scrollToPage = useCallback(
    (key: string) => {
      if (!report) return;
      document.getElementById(pageDomId(report.id, key))?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [report],
  );

  function focusItem(id: string) {
    if (!report) return;
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setCurrentId(id);
    const el = (it.row ? document.getElementById(rowDomId(report.id, it.row)) : null) ?? (it.page ? document.getElementById(pageDomId(report.id, it.page)) : null);
    el?.scrollIntoView({ behavior: "smooth", block: it.row ? "center" : "start" });
  }

  function nextItem() {
    if (!openWarnings.length) return;
    const idx = currentWarn ? openWarnings.indexOf(currentWarn) : -1;
    focusItem(openWarnings[(idx + 1) % openWarnings.length].id);
  }

  function accept(id: string, on: boolean) {
    setAccepted((prev) => {
      const ids = prev.key === editKey ? prev.ids : [];
      return { key: editKey, ids: on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id) };
    });
  }

  /* ---------------- current page + zoom ---------------- */

  const sectionCount = report?.sections.sections.length ?? 0;
  useEffect(() => {
    if (!report) return;
    const els = [...document.querySelectorAll<HTMLElement>(`[id^="${pageDomId(report.id, "")}"]`)];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setPage(Number((hit.target as HTMLElement).dataset.page ?? 0));
      },
      // Pages scroll inside the preview panel, not the window: observe within it. The page crossing a thin
      // band near the top of the panel is the current one.
      { root: scrollRef.current, rootMargin: "-15% 0px -80% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [report, sectionCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      setFitScale(Math.max(0.3, (el.clientWidth - pad * 2) / 600));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [report]);

  const scale = zoom.mode === "manual" ? zoom.value : zoom.mode === "fit" ? fitScale : Math.min(1, fitScale);
  const stepZoom = (d: number) => setZoom({ mode: "manual", value: Math.min(2, Math.max(0.5, Math.round((scale + d) * 10) / 10)) });

  /* ---------------- edits, review, export ---------------- */

  function selectReport(id: string) {
    if (id === selId) return;
    if (dirty && !window.confirm("You have unsaved commentary or next-action changes. Discard them and open another version?")) return;
    if (dirty) setSave("saved");
    setEdits(null);
    setCurrentId(null);
    setPage(0);
    setSelectedId(id);
  }

  function updateEdits(fn: (e: Edits) => Edits) {
    setEdits((prev) => fn(prev && prev.key === editKey ? prev : { key: editKey, commentary: {}, actions: null }));
    setSave("unsaved");
  }

  async function saveEdits() {
    if (!report || !myEdits) return;
    const commentary: Record<string, string> = {};
    for (const s of report.sections.sections) {
      const v = myEdits.commentary[s.key];
      if (v !== undefined && v !== s.commentary) commentary[s.key] = v;
    }
    const body: { expectedRowVersion: number; commentary?: Record<string, string>; nextActions?: Action[] } = { expectedRowVersion: report.rowVersion };
    if (Object.keys(commentary).length) body.commentary = commentary;
    if (myEdits.actions && JSON.stringify(myEdits.actions) !== JSON.stringify(report.sections.nextActions)) body.nextActions = myEdits.actions;
    const res = await mutate("Save report edits", () => api(`/api/reports/${report.id}`, { method: "PATCH", body }));
    if (res !== undefined) {
      setEdits(null);
      notify("ok", "Report edits saved");
    }
    reload();
  }

  function discardEdits() {
    setEdits(null);
    setSave("saved");
  }

  async function review(action: ReviewAction, comment?: string) {
    if (!report) return false;
    const labels = { submit: "Submit for review", approve: "Approve report", request_changes: "Request changes" };
    const res = await mutate(labels[action], () => api(`/api/reports/${report.id}/review`, { body: { expectedRowVersion: report.rowVersion, action, comment } }));
    reload();
    if (res !== undefined) notify("ok", action === "submit" ? "Submitted for review" : action === "approve" ? `v${report.version} approved and frozen` : "Changes requested");
    return res !== undefined;
  }

  async function exportPdf() {
    if (!report) return;
    const reportId = report.id;
    setExp({ reportId, phase: "running", status: "queued" });
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/reports/${reportId}/export`, { method: "POST" });
      const job = await waitForJob(jobId, (status) => setExp((p) => (p && p.reportId === reportId ? { ...p, status } : p)));
      if (job.status === "succeeded" && typeof job.result?.exportId === "string") {
        setExp({ reportId, phase: "done", status: job.status, exportId: job.result.exportId });
        reload();
      } else {
        setExp({ reportId, phase: "failed", status: job.status, error: job.error?.message ?? `Export ${job.status}` });
      }
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 403) setExp({ reportId, phase: "denied", status: "denied", error: e.message });
      else setExp({ reportId, phase: "failed", status: "failed", error: errMsg(e) });
    }
  }

  /* ---------------- latest event (approximate: report events since the latest version was created) ---------------- */

  const latest = useMemo(() => {
    const top = reports[0];
    if (!top || top.id !== selId) return null;
    const ev = ws.activity
      .filter((a) => a.objectType === "report" && a.createdAt >= top.createdAt && ACTIVITY_VERB[a.action])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!ev) return null;
    const who = (ev.actorId && ws.people[ev.actorId]) || "Someone";
    const when = date(ev.createdAt) === date(new Date()) ? time(ev.createdAt) : dateTime(ev.createdAt);
    return `${who} ${ACTIVITY_VERB[ev.action]} · ${when}`;
  }, [reports, selId, ws.activity, ws.people]);

  /* ---------------- render ---------------- */

  const newVersionModal = (
    <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New report version" width={560}>
      <CreateDraft
        onCancel={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          selectReport(id);
        }}
      />
    </Modal>
  );

  if (reports.length === 0) {
    return (
      <div className="flex flex-1 justify-center bg-[#ECEEF1] px-4 py-6 md:py-10">
        <div className="h-max w-full max-w-[640px] rounded-lg border border-line bg-surface px-5 md:px-8">
          <EmptyState title="No report yet">
            {canEdit
              ? "A report draft freezes the confirmed profile and the selected scenario results, so the report can always be reproduced. Choose what to include, then review the preview."
              : "No report has been drafted for this case yet. The assigned agent creates the draft; you’ll review it here."}
          </EmptyState>
          {canEdit && (
            <div className="border-t border-line py-5">
              <CreateDraft onCreated={(id) => selectReport(id)} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const pages = report?.sections.sections ?? [];
  const reviewerName = report?.reviewerId ? (ws.people[report.reviewerId] ?? null) : null;
  const pageWarn = (key: string) => openWarnings.some((w) => w.page === key);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-dvh lg:flex-none lg:flex-row">
      {/* Page thumbnails */}
      <nav aria-label="Report pages" className="hidden w-32 flex-none flex-col items-center gap-3.5 overflow-y-auto border-r border-line bg-subtle py-4 lg:flex">
        {report
          ? pages.map((sec, i) => {
              const cur = i === page;
              const warn = !isReviewed(report.status) && pageWarn(sec.key);
              return (
                <button
                  key={sec.key}
                  type="button"
                  aria-current={cur ? "page" : undefined}
                  aria-label={`Page ${i + 1}: ${sec.title}${warn ? ", has an open warning" : ""}`}
                  onClick={() => scrollToPage(sec.key)}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    aria-hidden="true"
                    className={cx("flex h-[92px] w-[68px] flex-col gap-1 rounded-[2px] border bg-surface px-[7px] py-2", cur ? "border-accent outline-2 outline-offset-2 outline-accent" : "border-line-strong hover:border-ink-secondary")}
                  >
                    <span className="h-1 w-[60%] bg-line-strong" />
                    <span className="h-[3px] w-[90%] bg-line" />
                    <span className="h-[3px] w-[80%] bg-line" />
                    <span className="h-[3px] w-[85%] bg-line" />
                    <span className="mt-1 h-3.5 w-full bg-hover" />
                  </span>
                  <span aria-hidden="true" className="flex gap-1 text-[11px] text-ink-secondary">
                    <span>{i + 1}</span>
                    <span className={warn ? "text-warn" : "text-ok"}>{warn ? "⚠︎" : "✓"}</span>
                  </span>
                </button>
              );
            })
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[92px] w-[68px] rounded-[2px]" />)}
      </nav>

      {/* Preview */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#ECEEF1]">
        <div className="sticky top-0 z-10 flex h-11 flex-none items-center gap-2 border-b border-line bg-surface px-3 text-[13px] md:px-5">
          {report ? (
            <>
              <span className="hidden min-w-0 truncate font-medium sm:inline">
                Page {page + 1} of {pages.length} · {pages[page]?.title}
              </span>
              <label className="sr-only" htmlFor="report-page-select">
                Go to page
              </label>
              <select
                id="report-page-select"
                value={page}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setPage(i);
                  scrollToPage(pages[i].key);
                }}
                className="h-8 min-w-0 rounded border border-line-strong bg-surface px-2 text-[13px] sm:hidden"
              >
                {pages.map((s, i) => (
                  <option key={s.key} value={i}>
                    Page {i + 1} of {pages.length} · {s.title}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-muted">Report preview</span>
          )}
          {refreshing && <Spinner label="Refreshing" />}
          <span className="flex-1" />
          <span className="hidden items-center gap-2 md:flex">
            <button type="button" aria-label="Zoom out" onClick={() => stepZoom(-0.1)} className="h-7 w-7 rounded border border-line-strong bg-surface hover:bg-hover">
              −
            </button>
            <button type="button" onClick={() => setZoom({ mode: "fit" })} aria-label="Fit page to width" className="w-14 text-center hover:text-accent">
              {zoom.mode === "fit" ? "Fit width" : `${Math.round(scale * 100)}%`}
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => stepZoom(0.1)} className="h-7 w-7 rounded border border-line-strong bg-surface hover:bg-hover">
              +
            </button>
          </span>
          {report && (
            <Button size="xs" className="ml-2" disabled={exp?.reportId === report.id && exp.phase === "running"} onClick={exportPdf}>
              {isReviewed(report.status) ? "Export PDF" : "Export draft PDF"}
            </Button>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-4 pb-[300px] lg:p-6 lg:pb-6">
          {!current && (
            <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3 bg-surface px-12 py-11 shadow-[var(--shadow-page)]">
              <Spinner label="Loading report" />
              <Skeleton className="w-1/2" />
              <Skeleton className="w-5/6" />
              <Skeleton className="w-2/3" />
            </div>
          )}
          {current?.error && (
            <div className="mx-auto max-w-[600px]">
              <Alert
                tone="bad"
                title="Couldn’t load this report"
                action={
                  <Button size="sm" onClick={reload}>
                    Try again
                  </Button>
                }
              >
                {current.error}
              </Alert>
            </div>
          )}
          {report && (
            <div style={{ zoom: scale }} className="flex justify-center">
              <Paper
                report={report}
                reviewerName={reviewerName}
                editable={canEdit && editableStatus(report.status)}
                commentaryFor={(k, orig) => myEdits?.commentary[k] ?? orig}
                onCommentary={(k, v) => updateEdits((e) => ({ ...e, commentary: { ...e.commentary, [k]: v } }))}
                actions={myEdits?.actions ?? report.sections.nextActions}
                onActions={(a) => updateEdits((e) => ({ ...e, actions: a }))}
                goScenarios={() => goTab("scenarios")}
                flag={flag}
              />
            </div>
          )}
        </div>
      </div>

      {report && (
        <ReviewPanel
          key={report.id}
          report={report}
          versions={reports}
          selId={selId}
          onSelectVersion={selectReport}
          items={items}
          accepted={acceptedIds}
          onAccept={accept}
          currentId={currentWarn?.id ?? null}
          onFocusItem={focusItem}
          onNext={nextItem}
          canEdit={canEdit}
          canReview={canReview}
          dirty={dirty}
          onSave={saveEdits}
          onDiscard={discardEdits}
          onReview={review}
          exp={exp && exp.reportId === report.id ? exp : null}
          onExport={exportPdf}
          onNewVersion={() => setNewOpen(true)}
          onReplace={() => goTab("scenarios")}
          latest={latest}
          reviewerName={reviewerName}
        />
      )}
      {!report && <aside aria-hidden="true" className="hidden w-[380px] flex-none border-l border-line bg-surface lg:block" />}

      {newVersionModal}
    </div>
  );
}
