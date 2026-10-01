"use client";

import { useId, useState } from "react";
import { Alert, Button, cx, human, StatusChip } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useWs } from "../context";
import { MAX_SCENARIOS } from "./model";

/** Scenario picker for a new report draft: up to three non-stale scenarios, first selected = base. */
export function CreateDraft({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const { ws, mutate, goTab } = useWs();
  const [picked, setPicked] = useState<string[]>([]);
  const [includeAreas, setIncludeAreas] = useState(true);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const scenarios = ws.scenarios.filter((s) => !s.archived);
  const unresolved = ws.readiness.filter((r) => r.status !== "ready");
  const validPicked = picked.filter((id) => scenarios.some((s) => s.id === id && s.staleBecause.length === 0));

  function toggle(id: string, on: boolean) {
    setPicked((p) => (on ? [...p.filter((x) => x !== id), id].slice(0, MAX_SCENARIOS) : p.filter((x) => x !== id)));
  }

  async function create() {
    setBusy(true);
    const res = await mutate("Create report draft", () =>
      api<{ id: string; version: number }>(`/api/assessments/${ws.assessment.id}/reports`, {
        body: { scenarioIds: validPicked, includeAreas, profileRevision: ws.assessment.currentRevision },
      }),
    );
    setBusy(false);
    if (res) {
      setPicked([]);
      onCreated(res.id);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-secondary">
        A draft freezes the confirmed profile (revision {ws.assessment.currentRevision}) and the selected scenario results. Figures in the report change only through recalculation and a new version.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-baseline text-[13px] font-semibold text-ink">
          <span className="flex-1">Scenarios to include</span>
          <span className="text-xs font-normal text-ink-secondary">
            {validPicked.length} of {MAX_SCENARIOS} selected
          </span>
        </legend>
        <p className="text-xs text-muted">The first scenario you select is the base; the others are compared against it.</p>
        {scenarios.length === 0 ? (
          <p className="text-[13px] text-ink-secondary">
            No scenarios yet.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => goTab("scenarios")}>
              Open the Scenario lab
            </button>{" "}
            to calculate one, or create a report without scenarios.
          </p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded border border-line">
            {scenarios.map((s, i) => {
              const stale = s.staleBecause.length > 0;
              const order = validPicked.indexOf(s.id);
              const checked = order >= 0;
              const full = !checked && validPicked.length >= MAX_SCENARIOS;
              const id = `${uid}-sc-${s.id}`;
              return (
                <li key={s.id} className={cx("flex items-start gap-3 px-3 py-2.5", i > 0 && "border-t border-line-soft", checked && "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]")}>
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-accent)]"
                    checked={checked}
                    disabled={stale || full}
                    aria-describedby={stale ? `${id}-stale` : full ? `${uid}-full` : undefined}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className={cx("text-sm font-medium", stale ? "text-faint" : "text-ink")}>
                        {s.name}
                      </label>
                      <span className="text-xs text-muted">{human(s.kind)}</span>
                      <StatusChip status={s.readiness} />
                    </span>
                    {stale && (
                      <span id={`${id}-stale`} className="text-xs text-warn">
                        ↻ Out of date — {s.staleBecause.slice(0, 3).join(", ")} changed. Recalculate in the Scenario lab first.
                      </span>
                    )}
                  </div>
                  {checked && <span className="flex-none text-xs font-medium text-accent">{order === 0 ? "1 · Base" : `${order + 1} · Compared`}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {validPicked.length >= MAX_SCENARIOS && (
          <p id={`${uid}-full`} className="text-xs text-muted">
            Up to {MAX_SCENARIOS} scenarios per report. Clear one to choose another.
          </p>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={includeAreas} onChange={(e) => setIncludeAreas(e.target.checked)} />
        Include area comparison
        <span className="text-xs text-muted">{ws.fits.length ? `${ws.fits.length} area${ws.fits.length === 1 ? "" : "s"} assessed` : "no areas assessed yet"}</span>
      </label>

      {unresolved.length > 0 ? (
        <Alert tone="warn" title="Conclusions lacking inputs are excluded and listed in the report">
          <ul className="mt-1 flex flex-col gap-1">
            {unresolved.map((r) => (
              <li key={r.output}>
                <span className="font-medium">{r.label}:</span> {r.summary}
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <p className="text-[13px] text-ok">✓ All outputs have the inputs they need.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create report draft"}
        </Button>
        {onCancel && (
          <Button variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
