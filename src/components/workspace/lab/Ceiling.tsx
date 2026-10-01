"use client";

import { useState } from "react";
import { AffixInput, Alert, Button, Field, MoneyInput } from "@/components/ui";
import { api, toCents } from "@/lib/client/api";
import { money } from "@/lib/format";
import { useWs } from "../context";
import { labelFor } from "../derive";
import { labelForInput } from "./shared";

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 }));

/** 9.2: highest feasible tested price with its binding constraint — not an approved budget. */
export function CeilingPanel() {
  const { ws } = useWs();
  const lvr = ws.profile.confirmed["finance.lvrCapPct"]?.value as number | undefined;
  const costs = ws.profile.confirmed["scenario.purchaseCosts"]?.value as number | undefined;
  const [f, setF] = useState({ min: "300,000", max: "2,000,000", step: "5,000", valuation: "100", lvr: String(lvr ?? ""), costsPct: "0", fixed: dollars(costs ?? null) });
  const [res, setRes] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const purpose = ws.profile.confirmed["goals.purchasePurpose"]?.value;

  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 px-5 py-3.5">
        <span className="flex-1 text-sm font-semibold text-ink">Funding ceiling</span>
        <span className="text-xs text-muted">Not a borrowing approval</span>
        <span aria-hidden="true" className="text-ink-secondary group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
        <p className="text-xs text-muted">Tests purchase prices against available funding, reserve, costs, valuation basis, LVR cap and the borrowing limit. Every assumption below is explicit. Household affordability is a separate check.</p>
        <form
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            try {
              setRes(
                await api(`/api/assessments/${ws.assessment.id}/scenarios/ceiling`, {
                  body: {
                    minPriceCents: toCents(f.min),
                    maxPriceCents: toCents(f.max),
                    stepCents: toCents(f.step),
                    valuationPctOfPrice: Number(f.valuation),
                    purchaseLvrCapPct: Number(f.lvr),
                    costsPctOfPrice: Number(f.costsPct),
                    fixedCostsCents: f.fixed ? toCents(f.fixed) : null,
                    purposeOverride: purpose === "undecided" ? "investment" : undefined,
                  },
                }),
              );
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not calculate");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Search from" htmlFor="c-min">
            <MoneyInput id="c-min" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          </Field>
          <Field label="Search to" htmlFor="c-max">
            <MoneyInput id="c-max" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
          </Field>
          <Field label="Precision" htmlFor="c-step">
            <MoneyInput id="c-step" value={f.step} onChange={(e) => setF({ ...f, step: e.target.value })} />
          </Field>
          <Field label="Valuation as share of price" htmlFor="c-val">
            <AffixInput id="c-val" type="number" suffix="%" value={f.valuation} onChange={(e) => setF({ ...f, valuation: e.target.value })} />
          </Field>
          <Field label="LVR cap for new loan" htmlFor="c-lvr">
            <AffixInput id="c-lvr" type="number" required suffix="%" value={f.lvr} onChange={(e) => setF({ ...f, lvr: e.target.value })} />
          </Field>
          <Field label="Fixed upfront costs" htmlFor="c-fixed" hint="Defaults to confirmed purchase costs">
            <MoneyInput id="c-fixed" value={f.fixed} onChange={(e) => setF({ ...f, fixed: e.target.value })} />
          </Field>
          <Field label="Plus costs as share of price" htmlFor="c-pct" hint="e.g. a duty approximation">
            <AffixInput id="c-pct" type="number" step="0.1" suffix="%" value={f.costsPct} onChange={(e) => setF({ ...f, costsPct: e.target.value })} />
          </Field>
          <div className="flex items-start pt-[26px]">
            <Button type="submit" disabled={busy}>
              {busy ? "Calculating…" : "Find funding ceiling"}
            </Button>
          </div>
        </form>
        {error && <Alert tone="bad">{error}</Alert>}
        {res && (
          <div aria-live="polite">
            {res.status === "feasible" && (
              <Alert tone="ok" title={`Highest feasible tested price: ${money(res.priceCents as number)}`}>
                Loan {money(res.loanCents as number)} · cash required {money(res.cashRequiredCents as number)} of {money(res.availableFundingCents as number)} available. Binding constraint: {String(res.bindingConstraint).replaceAll("_", " ")}.
                <ul className="mt-1 text-xs">
                  {(res.assumptions as string[]).map((a) => (
                    <li key={a}>• {a}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {res.status === "incomplete" && (
              <Alert tone="warn" title="Incomplete — cannot calculate a ceiling">
                Missing: {(res.missing as string[]).map((m) => (m.startsWith("borrowingLimit") ? labelFor("finance.limitScope") + " / borrowing limit" : labelForInput(m))).join(", ")}
              </Alert>
            )}
            {res.status === "no_feasible_scenario" && (
              <Alert tone="bad" title="No feasible scenario">
                {String(res.reason)} between {money(res.testedFromCents as number)} and {money(res.testedToCents as number)}.
              </Alert>
            )}
            {res.status === "invalid" && (
              <Alert tone="bad" title="Invalid inputs">
                {(res.errors as string[]).join("; ")}
              </Alert>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
