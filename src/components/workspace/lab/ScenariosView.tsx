"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cx, EmptyState, StatusChip } from "@/components/ui";
import { api, newKey } from "@/lib/client/api";
import { applyChanges, type ScenarioChange } from "@/lib/finance/patch";
import { dateTime } from "@/lib/format";
import { useWs } from "../context";
import { get, inputsOf, labelFor, type Scn } from "../derive";
import { AssumptionsAside, draftOf, type Draft } from "./Assumptions";
import { CeilingPanel } from "./Ceiling";
import { Answer, AssumptionsSources, CheckAlerts, Comparison, FullResults, KeyFigures, MissingInputs, StaleAlert } from "./Results";
import { DashedChip, LabToolbar } from "./shared";
import { FieldEditor } from "../FieldEditor";
import { WhatIfPanel } from "./WhatIf";

type CreateBody = { name: string; kind: "base" | "downside" | "upside" | "alternative"; parentScenarioId?: string | null; changes?: ScenarioChange[]; purposeOverride?: "investment" | "ppor" };

/** The comparison reference: the parent scenario, else the latest current base for the same purpose. */
function referenceFor(all: Scn[], s: Scn): Scn | null {
  if (s.parentScenarioId) {
    const p = all.find((x) => x.id === s.parentScenarioId);
    if (p) return p;
  }
  if (s.kind === "base") return null;
  const purpose = inputsOf(s).purpose;
  const bases = all.filter((x) => x.kind === "base" && x.id !== s.id && inputsOf(x).purpose === purpose);
  return bases.filter((x) => !x.staleBecause.length).at(-1) ?? bases.at(-1) ?? null;
}

export function ScenariosView() {
  const { ws, mutate, notify } = useWs();
  const scenarios = ws.scenarios;
  const canEdit = ws.permissions.canEdit;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = scenarios.find((s) => s.id === activeId) ?? scenarios.at(-1) ?? null;
  const purpose = get<string>(ws, "goals.purchasePurpose");

  const create = async (body: CreateBody) => {
    setBusy(true);
    try {
      const res = await mutate("Calculate scenario", () =>
        api<{ id: string; duplicate: boolean }>(`/api/assessments/${ws.assessment.id}/scenarios`, {
          body: { action: "create", idempotencyKey: newKey(), profileRevision: ws.assessment.currentRevision, changes: [], ...body },
        }),
      );
      if (res) {
        setActiveId(res.id);
        if (res.duplicate) notify("info", "An identical scenario already exists; it has been selected.");
      }
      return res;
    } finally {
      setBusy(false);
    }
  };

  const createBase = (p?: "investment" | "ppor") =>
    create(p ? { name: p === "investment" ? "Investment path — base" : "Home (PPOR) path — base", kind: "base", purposeOverride: p } : { name: "Base case", kind: "base" });

  const archive = (s: Scn) => mutate("Archive scenario", () => api(`/api/assessments/${ws.assessment.id}/scenarios`, { body: { action: "archive", scenarioId: s.id } }));

  const duplicate = (s: Scn) => {
    const parent = s.parentScenarioId && scenarios.some((x) => x.id === s.parentScenarioId) ? s.parentScenarioId : null;
    return create({
      name: `${s.name} (copy)`.slice(0, 80),
      kind: "alternative",
      parentScenarioId: parent ?? s.id,
      changes: parent ? (s.changes as ScenarioChange[]) : [],
    });
  };

  const refScn = active ? referenceFor(scenarios, active) : null;

  // Repeated names (e.g. a recalculated "Base case") get a version number so the chips are distinguishable.
  const chipLabel = new Map<string, string>();
  {
    const seen = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const s of scenarios) totals.set(s.name, (totals.get(s.name) ?? 0) + 1);
    for (const s of scenarios) {
      const n = (seen.get(s.name) ?? 0) + 1;
      seen.set(s.name, n);
      if ((totals.get(s.name) ?? 0) > 1) chipLabel.set(s.id, `${s.name} · v${n}`);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <LabToolbar>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto" role="group" aria-label="Scenarios">
          {[...scenarios.filter((s) => !s.staleBecause.length), ...scenarios.filter((s) => s.staleBecause.length)].map((s) => {
            const on = s.id === active?.id;
            const stale = s.staleBecause.length > 0;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveId(s.id)}
                className={cx(
                  "flex h-[30px] shrink-0 items-center gap-1.5 rounded border px-3 text-[13px] font-medium whitespace-nowrap max-md:h-9 max-md:text-sm",
                  on ? "border-accent bg-accent-tint text-accent" : stale ? "border-dashed border-line-strong bg-subtle text-muted hover:bg-hover" : "border-line-strong bg-surface text-ink hover:bg-hover",
                )}
                title={stale ? "Calculated from an older profile — kept for the record. Recalculate to use it." : undefined}
              >
                {chipLabel.get(s.id) ?? s.name}
                {stale && <span className="text-[11px] text-warn">↻ Out of date</span>}
                {s.readiness !== "complete" && !s.staleBecause.length && <span className="text-[11px] font-normal text-muted">{s.readiness === "invalid" ? "✕ Invalid" : "Incomplete"}</span>}
              </button>
            );
          })}
        </div>
        {canEdit && <NewScenario undecided={purpose === "undecided"} busy={busy} onCreate={createBase} />}
        <span className="flex-1" />
        {active && (
          <>
            <span className="hidden text-xs whitespace-nowrap text-muted xl:inline">
              Engine v{active.calculationVersion} · calculated {dateTime(active.createdAt)}
            </span>
            {canEdit && (
              <>
                <Button size="sm" disabled={busy} onClick={() => duplicate(active)} className="max-md:hidden">
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => archive(active)} className="max-md:hidden" title="Hide this scenario from the lab. It stays reproducible.">
                  Archive
                </Button>
              </>
            )}
          </>
        )}
      </LabToolbar>

      {!active ? (
        <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
          <EmptyScenarios onCreate={createBase} undecided={purpose === "undecided"} busy={busy} />
          <CeilingPanel />
        </div>
      ) : (
        <Workbench key={active.id} s={active} refScn={refScn} busy={busy} onCreate={create} />
      )}
    </div>
  );
}

function NewScenario({ undecided, busy, onCreate }: { undecided: boolean; busy: boolean; onCreate: (p?: "investment" | "ppor") => void }) {
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
  if (!undecided)
    return (
      <DashedChip disabled={busy} onClick={() => onCreate()} title="Calculate a new base case from the confirmed profile">
        + New scenario
      </DashedChip>
    );
  return (
    <div ref={ref} className="relative shrink-0">
      <DashedChip disabled={busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        + New scenario
      </DashedChip>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-30 mt-1 flex w-64 flex-col rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-overlay)]">
          <span className="px-3 py-1.5 text-xs text-muted">Purpose undecided — choose a path</span>
          {(["investment", "ppor"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className="px-3 py-2 text-left text-[13px] text-ink hover:bg-hover"
              onClick={() => {
                setOpen(false);
                onCreate(p);
              }}
            >
              {p === "investment" ? "Investment path — base" : "Home (PPOR) path — base"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyScenarios({ onCreate, undecided, busy }: { onCreate: (p?: "investment" | "ppor") => void; undecided: boolean; busy: boolean }) {
  const { ws } = useWs();
  const readiness = ws.readiness.filter((r) => ["deposit_scenario", "rental_cashflow", "funding_ceiling"].includes(r.output));
  return (
    <div className="flex flex-col gap-4">
      <InputsNeeded />
      <EmptyState
        title="No scenarios yet"
        action={
          ws.permissions.canEdit &&
          (undecided ? (
            <>
              <Button variant="primary" disabled={busy} onClick={() => onCreate("investment")}>
                Calculate investment path
              </Button>
              <Button disabled={busy} onClick={() => onCreate("ppor")}>
                Calculate home path
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => onCreate()}>
              Calculate base case
            </Button>
          ))
        }
      >
        Calculate a base case from the confirmed profile. Results show which inputs are still missing — missing inputs return “Incomplete” and are never treated as zero. Scenarios are indicative calculations, not lender assessments.
      </EmptyState>
      {readiness.length > 0 && (
        <ul className="grid max-w-[900px] gap-3 sm:grid-cols-3">
          {readiness.map((r) => (
            <li key={r.output} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{r.label}</span>
                <StatusChip status={r.status} />
              </div>
              <p className="text-xs text-muted">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Inputs the base scenario still needs, listed before calculating so nothing comes back "Incomplete"
 * by surprise. Each can be filled in place; values save to the profile like any other edit.
 */
export function InputsNeeded({ compact }: { compact?: boolean }) {
  const { ws, mutate } = useWs();
  const [editing, setEditing] = useState<string | null>(null);
  const purpose = ws.profile.confirmed["goals.purchasePurpose"]?.value;
  const outputs = purpose === "ppor" ? ["deposit_scenario"] : ["deposit_scenario", "rental_cashflow"];
  const fromReadiness = ws.readiness.filter((r) => outputs.includes(r.output)).flatMap((r) => r.missing);
  // A home purchase has no rental-cashflow output, but its annual ownership cost still needs loan terms
  // and running costs — list them too, or the result comes back "Incomplete" after the panel cleared.
  const pporExtras =
    purpose === "ppor"
      ? ["finance.interestRatePct", "finance.loanTermYears", "finance.repaymentType", "scenario.annualOperatingCosts"]
          .filter((p) => !ws.profile.confirmed[p] || ws.profile.confirmed[p].state !== "value")
          .map((p) => ({ path: p, label: p === "scenario.annualOperatingCosts" ? "Annual ownership costs (rates, insurance, maintenance, strata)" : labelFor(p) }))
      : [];
  const missing = [...new Map([...fromReadiness, ...pporExtras].map((m) => [m.path, m])).values()];
  if (!missing.length) return null;
  return (
    <section aria-label="Inputs still needed" className="max-w-[900px] rounded-lg border border-warn-line bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-warn-line bg-warn-tint px-5 py-3">
        <span className="text-[13px] font-semibold text-warn">
          <span aria-hidden="true">⚠︎ </span>
          {missing.length} input{missing.length === 1 ? "" : "s"} still needed {compact ? "for a complete scenario" : "before you calculate"}
        </span>
        <span className="text-xs text-warn-ink">Missing inputs show as “Incomplete” — they are never treated as zero.</span>
      </header>
      <ul>
        {missing.map((m) => (
          <li key={m.path} className="border-b border-line-soft px-5 py-2.5 last:border-b-0">
            {editing === m.path ? (
              <FieldEditor
                path={m.path}
                allowStates={false}
                saveLabel="Save"
                onCancel={() => setEditing(null)}
                onSave={async (e) => {
                  const ok = await mutate("Save input", () =>
                    api(`/api/assessments/${ws.assessment.id}/profile`, { method: "PATCH", body: { action: "set", expectedRevision: ws.assessment.currentRevision, fields: [{ path: m.path, ...e }] } }),
                  );
                  if (ok !== undefined) setEditing(null);
                }}
              />
            ) : (
              <div className="flex items-center gap-3 text-[13px]">
                <span className="flex-1 text-ink-2">{m.label}</span>
                {ws.permissions.canEdit && (
                  <button type="button" onClick={() => setEditing(m.path)} className="text-xs font-medium text-accent hover:underline">
                    Add
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const dollars = (c: number) => (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 });

function Workbench({ s, refScn, busy, onCreate }: { s: Scn; refScn: Scn | null; busy: boolean; onCreate: (b: CreateBody) => Promise<unknown> }) {
  const { ws } = useWs();
  const canEdit = ws.permissions.canEdit;
  const inputs = inputsOf(s);
  const [draft, setDraft] = useState<Draft>(() => draftOf(inputs));
  const stale = s.staleBecause.length > 0;

  const run = (changes: ScenarioChange[], name: string, kind: CreateBody["kind"] = "alternative") => void onCreate({ name, kind, parentScenarioId: s.id, changes });

  const editChanges = (changes: ScenarioChange[]) => {
    const extra = changes.reduce((t, c) => (c.op === "add_annual_cost" ? t + c.cents : t), 0);
    const applied = applyChanges(inputs, changes.filter((c) => c.op !== "add_annual_cost"));
    setDraft({ ...draftOf(applied), extraCost: extra ? dollars(extra) : "" });
    document.getElementById("as-rate")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <AssumptionsAside s={s} refScn={refScn} draft={draft} setDraft={setDraft} busy={busy} onRun={(ch, name) => run(ch, name)} />
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-4 md:px-8 md:py-6">
        {canEdit && <WhatIfPanel s={s} busy={busy} onRun={run} onEdit={editChanges} className="max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:order-last max-lg:shadow-[var(--shadow-overlay)]" />}
        {stale && <StaleAlert s={s} busy={busy} onRecalc={() => void onCreate({ name: s.name, kind: s.kind, changes: s.changes as ScenarioChange[], purposeOverride: inputs.purpose ?? undefined })} />}
        <Answer s={s} refScn={refScn} />
        <KeyFigures s={s} refScn={refScn} stale={stale} />
        <CheckAlerts s={s} />
        <MissingInputs s={s} />
        {s.readiness !== "complete" && <InputsNeeded compact />}
        {refScn && <Comparison s={s} refScn={refScn} />}
        <FullResults s={s} defaultOpen={!refScn} />
        <AssumptionsSources s={s} />
        <CeilingPanel />
      </div>
    </div>
  );
}
