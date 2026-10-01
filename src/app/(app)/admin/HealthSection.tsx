"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Skeleton, human, type Tone } from "@/components/ui";
import { time } from "@/lib/format";
import { Panel, TD, TH, TitleRow, TONE_TEXT, type TextTone } from "./shared";

interface HealthResponse {
  status: string;
  database: string;
  time: string;
  window?: string;
  ai?: {
    configured: boolean;
    model: string | null;
    byMode: { mode: string; calls: number; failures: number; avgLatencyMs: number; inputTokens: number; outputTokens: number; assessments: number }[];
  };
  marketProvider?: { id: string; label: string; configured: boolean };
  jobs?: { type: string; status: string; n: number }[];
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: HealthResponse };

const JOB_TONE: Record<string, Tone> = { succeeded: "ok", failed: "bad", running: "info", queued: "neutral", cancelled: "muted" };

const fmt = (n: number) => n.toLocaleString("en-AU");
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const latency = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

interface Tile {
  label: string;
  value: string;
  note: string;
  tone: TextTone;
}

/** Tiles derived only from what /api/health returns — no targets or metrics it does not measure. */
function tilesFor(d: HealthResponse): Tile[] {
  const tiles: Tile[] = [
    {
      label: "Database",
      value: d.database === "ok" ? "OK" : "Unavailable",
      note: d.database === "ok" ? "✓ Responding" : "✕ Not responding",
      tone: d.database === "ok" ? "ok" : "bad",
    },
  ];
  if (d.jobs) {
    const total = d.jobs.reduce((s, j) => s + j.n, 0);
    const failed = d.jobs.filter((j) => j.status === "failed");
    const failedN = failed.reduce((s, j) => s + j.n, 0);
    const pending = d.jobs.filter((j) => j.status === "queued" || j.status === "running").reduce((s, j) => s + j.n, 0);
    tiles.push({
      label: "Failed jobs",
      value: fmt(failedN),
      note: failedN ? `⚠︎ ${[...new Set(failed.map((j) => human(j.type)))].join(", ")}` : total ? `✓ None of ${fmt(total)} jobs` : "No jobs in this window",
      tone: failedN ? "warn" : total ? "ok" : "muted",
    });
    tiles.push({ label: "Jobs queued or running", value: fmt(pending), note: `${fmt(total)} jobs in this window`, tone: "muted" });
  }
  if (d.ai) {
    const rows = d.ai.byMode;
    const calls = rows.reduce((s, r) => s + r.calls, 0);
    const failures = rows.reduce((s, r) => s + r.failures, 0);
    const avg = calls ? Math.round(rows.reduce((s, r) => s + r.avgLatencyMs * r.calls, 0) / calls) : null;
    const tin = rows.reduce((s, r) => s + r.inputTokens, 0);
    const tout = rows.reduce((s, r) => s + r.outputTokens, 0);
    tiles.push({
      label: "AI calls",
      value: fmt(calls),
      note: failures ? `⚠︎ ${fmt(failures)} failed` : calls ? "✓ No failures" : d.ai.configured ? "No calls in this window" : "— AI not configured",
      tone: failures ? "warn" : calls ? "ok" : "muted",
    });
    tiles.push({ label: "AI average latency", value: avg == null ? "—" : latency(avg), note: avg == null ? "No calls to measure" : "Mean across all modes", tone: "muted" });
    tiles.push({ label: "AI tokens", value: compact(tin + tout), note: `${compact(tin)} in · ${compact(tout)} out`, tone: "muted" });
  }
  if (d.marketProvider) {
    tiles.push({
      label: "Market data provider",
      value: d.marketProvider.configured ? "Configured" : "None",
      note: d.marketProvider.configured ? `✓ ${d.marketProvider.label}` : "— Manual evidence only",
      tone: d.marketProvider.configured ? "ok" : "muted",
    });
  }
  return tiles;
}

export function HealthSection({ canViewMetrics, title }: { canViewMetrics: boolean; title: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as HealthResponse) : null;
      if (!data) throw new Error(`Health check failed (${res.status})`);
      setState({ kind: "ok", data });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Health check failed" });
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const data = state.kind === "ok" ? state.data : null;
  const heading = data?.window ? `Health · last ${data.window}` : "Health";

  return (
    <>
      <TitleRow title={title} />
      <Panel
        title={heading}
        aside={
          <span className="flex items-center gap-2 text-xs text-muted">
            {data && <span>Updated {time(data.time)}</span>}
            <Button size="xs" variant="tertiary" onClick={() => void load()} disabled={state.kind === "loading"}>
              {state.kind === "loading" ? "Refreshing…" : "Refresh"}
            </Button>
          </span>
        }
      >
        <div aria-live="polite" aria-busy={state.kind === "loading"}>
          {state.kind === "loading" && (
            <div className="grid grid-cols-1 sm:grid-cols-2" role="status" aria-label="Loading health status">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2.5 border-b border-line-soft px-5 py-4 sm:border-r">
                  <Skeleton className="w-24" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="w-32" />
                </div>
              ))}
            </div>
          )}
          {state.kind === "error" && (
            <div className="p-4 md:p-5">
              <Alert
                tone="bad"
                title="Could not load health status"
                action={
                  <Button size="sm" onClick={() => void load()}>
                    Try again
                  </Button>
                }
              >
                {state.message}
              </Alert>
            </div>
          )}
          {data && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {tilesFor(data).map((t) => (
                  <div key={t.label} className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3.5 sm:border-r md:px-5">
                    <span className="text-xs text-ink-secondary">{t.label}</span>
                    <span className="num text-xl font-semibold text-ink">{t.value}</span>
                    <span className={`text-xs font-medium ${TONE_TEXT[t.tone]}`}>{t.note}</span>
                  </div>
                ))}
              </div>
              {!data.ai && (
                <div className="p-4 md:p-5">
                  <Alert tone="info" title="Operational metrics unavailable">
                    {canViewMetrics
                      ? "The health endpoint returned liveness only. Operational metrics may be unavailable while the database is degraded."
                      : "Detailed AI and job metrics are shown to organisation administrators only."}
                  </Alert>
                </div>
              )}
              {(data.ai || data.jobs) && <HealthDetails data={data} />}
            </>
          )}
        </div>
      </Panel>
      <p className="text-xs text-muted">Health metrics never include buyer financial values.</p>
    </>
  );
}

function HealthDetails({ data }: { data: HealthResponse }) {
  const win = data.window ?? "7 days";
  return (
    <details className="group">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] text-accent hover:bg-hover md:px-5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        Details · AI calls by mode and jobs by status
      </summary>
      <div className="flex flex-col gap-5 border-t border-line pb-4">
        {data.ai && (
          <div>
            <h3 className="px-4 pt-4 pb-2 text-[13px] font-semibold text-ink md:px-5">AI calls by mode ({win})</h3>
            {data.ai.byMode.length === 0 ? (
              <p className="px-4 text-[13px] text-muted md:px-5">No AI calls in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-[13px]">
                  <caption className="sr-only">AI calls by mode</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Mode
                      </th>
                      {["Calls", "Failures", "Avg latency", "Input tokens", "Output tokens", "Assessments"].map((h) => (
                        <th key={h} scope="col" className={`${TH} text-right`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.ai.byMode.map((r) => (
                      <tr key={r.mode}>
                        <th scope="row" className={`${TD} text-left font-medium`}>
                          {human(r.mode)}
                        </th>
                        <td className={`${TD} num text-right`}>{fmt(r.calls)}</td>
                        <td className={`${TD} num text-right`}>{r.failures > 0 ? <Badge tone="bad">{fmt(r.failures)} failed</Badge> : <span className="text-muted">0</span>}</td>
                        <td className={`${TD} num text-right`}>{fmt(r.avgLatencyMs)} ms</td>
                        <td className={`${TD} num text-right`}>{fmt(r.inputTokens)}</td>
                        <td className={`${TD} num text-right`}>{fmt(r.outputTokens)}</td>
                        <td className={`${TD} num text-right`}>{fmt(r.assessments)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {data.jobs && (
          <div>
            <h3 className="px-4 pb-2 text-[13px] font-semibold text-ink md:px-5">Jobs by type and status ({win})</h3>
            {data.jobs.length === 0 ? (
              <p className="px-4 text-[13px] text-muted md:px-5">No jobs in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-[13px]">
                  <caption className="sr-only">Jobs by type and status</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Type
                      </th>
                      <th scope="col" className={TH}>
                        Status
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={`${j.type}-${j.status}`}>
                        <th scope="row" className={`${TD} text-left font-medium`}>
                          {human(j.type)}
                        </th>
                        <td className={TD}>
                          <Badge tone={JOB_TONE[j.status] ?? "muted"}>{human(j.status)}</Badge>
                        </td>
                        <td className={`${TD} num text-right`}>{fmt(j.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
