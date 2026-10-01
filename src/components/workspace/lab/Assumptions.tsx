"use client";

import { useState, type ReactNode } from "react";
import { Button, cx, Mark, Segmented, type MarkKind } from "@/components/ui";
import { toCents } from "@/lib/client/api";
import type { ScenarioChange } from "@/lib/finance/patch";
import type { RepaymentType, ScenarioInputs } from "@/lib/finance/types";
import { money, rate } from "@/lib/format";
import { useWs } from "../context";
import { inputsOf, markFor, type Scn } from "../derive";
import { nameFor, sumCosts } from "./shared";

export type Draft = { price: string; loan: string; equity: string; rate: string; repayment: RepaymentType | ""; rent: string; vacant: string; extraCost: string };

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 }));

export function draftOf(i: ScenarioInputs): Draft {
  return {
    price: dollars(i.purchasePriceCents),
    loan: dollars(i.purchaseLoan.principalCents),
    equity: dollars(i.equityDraw?.principalCents ?? null),
    rate: i.purchaseLoan.ratePct != null ? i.purchaseLoan.ratePct.toFixed(2) : "",
    repayment: i.purchaseLoan.repayment ?? "",
    rent: dollars(i.rent?.weeklyCents ?? null),
    vacant: i.rent?.vacantWeeks != null ? String(i.rent.vacantWeeks) : "",
    extraCost: "",
  };
}

const okCents = (v: string) => {
  const c = toCents(v);
  return c != null && !Number.isNaN(c) ? c : null;
};

/** Same mapping as the original "Edit assumptions" controls: draft values → ScenarioChange[] against the selected scenario. */
export function draftChanges(form: Draft, inputs: ScenarioInputs): ScenarioChange[] {
  const ch: ScenarioChange[] = [];
  const price = okCents(form.price);
  if (price != null && price !== inputs.purchasePriceCents) ch.push({ op: "set_price", cents: price, alsoValuation: true });
  const loan = okCents(form.loan);
  if (loan != null && loan !== inputs.purchaseLoan.principalCents) ch.push({ op: "set_purchase_loan", cents: loan });
  const eq = okCents(form.equity);
  if (inputs.equityDraw && eq != null && eq !== inputs.equityDraw.principalCents) ch.push({ op: "set_equity_draw", cents: eq });
  if (form.rate !== "" && Number.isFinite(Number(form.rate)) && Number(form.rate) !== inputs.purchaseLoan.ratePct) ch.push({ op: "set_rate", pct: Number(form.rate) });
  if (form.repayment && form.repayment !== inputs.purchaseLoan.repayment) ch.push({ op: "set_repayment", repayment: form.repayment });
  const rent = okCents(form.rent);
  if (inputs.rent && rent != null && rent !== inputs.rent.weeklyCents) ch.push({ op: "set_weekly_rent", cents: rent });
  if (inputs.rent && form.vacant !== "" && Number.isFinite(Number(form.vacant)) && Number(form.vacant) !== inputs.rent.vacantWeeks) ch.push({ op: "set_vacant_weeks", weeks: Number(form.vacant) });
  const extra = okCents(form.extraCost);
  if (extra != null && extra > 0) ch.push({ op: "add_annual_cost", label: "Additional annual cost / repairs", cents: extra });
  return ch;
}

/** ○ Assumption / ◐ Estimated / ✓ Confirmed for one input, from the scenario's labels then the profile. */
function markOf(ws: ReturnType<typeof useWs>["ws"], s: Scn, key: string, path: string): { kind: MarkKind; label?: string } {
  const label = s.assumptionLabels[key];
  if (label == null) return Object.keys(s.assumptionLabels).some((k) => k.startsWith("change:")) ? { kind: "assumption" } : { kind: "missing" };
  if (/not confirmed|unavailable|needs a/i.test(label)) return { kind: "missing" };
  if (/assumed/i.test(label)) return { kind: "assumption" };
  const m = markFor(ws, path);
  return m.kind === "notasked" || m.kind === "suggested" ? { kind: "confirmed" } : m;
}

function Control({
  id,
  label,
  mark,
  changed,
  prefix,
  suffix,
  value,
  onChange,
  onStep,
  note,
  readOnly,
  placeholder,
}: {
  id: string;
  label: string;
  mark?: { kind: MarkKind; label?: string };
  changed?: boolean;
  prefix?: string;
  suffix?: string;
  value: string;
  onChange?: (v: string) => void;
  onStep?: (dir: 1 | -1) => void;
  note?: ReactNode;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <label htmlFor={id} className="flex-1 text-[13px] font-medium text-ink-secondary">
          {label}{" "}
          {changed && (
            <span className="text-accent" title="Changed from base">
              ●<span className="sr-only"> changed from base</span>
            </span>
          )}
        </label>
        {mark && <Mark kind={mark.kind} label={mark.label} small />}
      </div>
      <div className={cx("flex h-9 overflow-hidden rounded border bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent", changed ? "border-accent" : "border-line-strong", readOnly && "bg-subtle")}>
        {onStep && !readOnly && (
          <button type="button" onClick={() => onStep(-1)} aria-label={`Decrease ${label}`} className="flex w-8 shrink-0 items-center justify-center border-r border-line bg-subtle text-[15px] text-ink-secondary hover:bg-hover">
            −
          </button>
        )}
        {prefix && <span className="flex items-center pl-2 text-[13px] text-muted">{prefix}</span>}
        <input
          id={id}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          inputMode="decimal"
          autoComplete="off"
          onChange={(e) => onChange?.(e.target.value)}
          className="num min-w-0 flex-1 bg-transparent px-1.5 text-right text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-faint read-only:text-ink-2"
        />
        {suffix && <span className="flex items-center pr-2 text-xs whitespace-nowrap text-muted">{suffix}</span>}
        {onStep && !readOnly && (
          <button type="button" onClick={() => onStep(1)} aria-label={`Increase ${label}`} className="flex w-8 shrink-0 items-center justify-center border-l border-line bg-subtle text-[15px] text-ink-secondary hover:bg-hover">
            +
          </button>
        )}
      </div>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <div className="mt-1.5 border-t border-line-soft pt-3 pb-1.5 text-xs font-medium text-muted">{title}</div>
      {children}
    </div>
  );
}

export function AssumptionsAside({
  s,
  refScn,
  draft,
  setDraft,
  onRun,
  busy,
}: {
  s: Scn;
  refScn: Scn | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onRun: (changes: ScenarioChange[], name: string) => void;
  busy: boolean;
}) {
  const { ws } = useWs();
  const canEdit = ws.permissions.canEdit;
  const [open, setOpen] = useState(false);
  const i = inputsOf(s);
  const r = refScn ? inputsOf(refScn) : null;
  const ppor = i.purpose === "ppor";
  const own = draftOf(i);
  const changes = canEdit ? draftChanges(draft, i) : [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  const step = (k: "rate" | "rent" | "vacant", by: number, dp: number, min = 0, max = Infinity) => (dir: 1 | -1) => {
    const cur = k === "rate" ? Number(draft.rate) : k === "rent" ? (okCents(draft.rent) ?? 0) / 100 : Number(draft.vacant);
    const n = Math.min(max, Math.max(min, (Number.isFinite(cur) ? cur : 0) + dir * by));
    set(k, k === "rent" ? n.toLocaleString("en-AU", { maximumFractionDigits: 2 }) : n.toFixed(dp));
  };

  const diffBase = <T,>(get: (x: ScenarioInputs) => T) => r != null && get(r) !== get(i);
  const baseNote = <T,>(get: (x: ScenarioInputs) => T | null, fmt: (v: T) => string) => (r && diffBase(get) ? `Base ${get(r) == null ? "—" : fmt(get(r) as T)}` : null);
  const join = (...p: (string | null | false | undefined)[]) => p.filter(Boolean).join(" · ");

  const valuation = i.lenderValuationCents;
  const loanC = okCents(draft.loan);
  const lvr = loanC != null && valuation ? `${Math.round((loanC / valuation) * 1000) / 10}% LVR on ${money(valuation)}` : "LVR needs a loan and valuation";

  const flags = {
    price: diffBase((x) => x.purchasePriceCents) || draft.price !== own.price,
    equity: diffBase((x) => x.equityDraw?.principalCents ?? null) || draft.equity !== own.equity,
    loan: diffBase((x) => x.purchaseLoan.principalCents) || draft.loan !== own.loan,
    rate: diffBase((x) => x.purchaseLoan.ratePct) || draft.rate !== own.rate,
    repayment: diffBase((x) => x.purchaseLoan.repayment) || draft.repayment !== own.repayment,
    rent: diffBase((x) => x.rent?.weeklyCents ?? null) || draft.rent !== own.rent,
    vacant: diffBase((x) => x.rent?.vacantWeeks ?? null) || draft.vacant !== own.vacant,
    opcosts: diffBase((x) => sumCosts(x.operatingCosts)),
    extra: draft.extraCost.trim() !== "",
  };
  const nChanged = Object.values(flags).filter(Boolean).length;
  const termYears = i.purchaseLoan.termMonths != null ? `term ${Math.round(i.purchaseLoan.termMonths / 12)} yrs` : "term not set";
  const ro = !canEdit;

  return (
    <aside aria-label="Assumptions" className="shrink-0 border-line bg-surface max-lg:mx-4 max-lg:mt-4 max-lg:rounded-lg max-lg:border lg:w-[320px] lg:border-r">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-12 w-full items-center px-4 text-left text-[15px] font-medium lg:hidden">
        <span className="flex-1">
          Assumptions · {nChanged} changed
        </span>
        <span aria-hidden="true" className="text-ink-secondary">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div className={cx("flex-col gap-1.5 p-5 max-lg:border-t max-lg:border-line max-lg:p-4", open ? "flex" : "hidden lg:flex")}>
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-sm font-semibold text-ink">Assumptions · {s.name}</span>
          {canEdit && (r || changes.length > 0) && (
            <button type="button" className="text-xs text-accent hover:text-accent-hover hover:underline" onClick={() => setDraft(draftOf(r ?? i))}>
              {r ? "Reset to base" : "Reset"}
            </button>
          )}
        </div>
        <span className="mb-1.5 text-xs text-muted">Changed from base are marked ●</span>

        <Group title="Purchase">
          <Control id="as-price" label="Purchase price" prefix="$" value={draft.price} onChange={(v) => set("price", v)} readOnly={ro} changed={flags.price} mark={markOf(ws, s, "purchasePriceCents", "scenario.targetPrice")} note={join(baseNote((x) => x.purchasePriceCents, money), valuation != null && valuation === i.purchasePriceCents ? "Also lender valuation" : valuation != null ? `Valuation ${money(valuation)}` : null)} />
          <Control id="as-costs" label="Purchase costs" prefix="$" value={money(sumCosts(i.purchaseCosts)).replace("$", "").replace("—", "")} placeholder="—" readOnly changed={diffBase((x) => sumCosts(x.purchaseCosts))} mark={markOf(ws, s, "purchaseCosts", "scenario.purchaseCosts")} note="Duty, conveyancing, fees · edit in the profile" />
        </Group>

        <Group title="Funding">
          {i.equityDraw && (
            <Control id="as-equity" label="Equity release" prefix="$" value={draft.equity} onChange={(v) => set("equity", v)} readOnly={ro} changed={flags.equity} mark={markOf(ws, s, "equityDraw.principalCents", "finance.equityDrawAmount")} note={join(baseNote((x) => x.equityDraw?.principalCents ?? null, money), "Fully allocated to settlement")} />
          )}
          <Control id="as-loan" label="Purchase loan" prefix="$" value={draft.loan} onChange={(v) => set("loan", v)} readOnly={ro} changed={flags.loan} mark={markOf(ws, s, "purchaseLoan.principalCents", "scenario.purchaseLoanAmount")} note={join(baseNote((x) => x.purchaseLoan.principalCents, money), lvr)} />
        </Group>

        <Group title="Loans">
          <Control
            id="as-rate"
            label={i.equityDraw ? "Interest rate · both new loans" : "Interest rate"}
            suffix="% p.a."
            value={draft.rate}
            onChange={(v) => set("rate", v)}
            onStep={step("rate", 0.25, 2, 0, 30)}
            readOnly={ro}
            changed={flags.rate}
            mark={markOf(ws, s, "purchaseLoan.ratePct", "finance.interestRatePct")}
            note={join(baseNote((x) => x.purchaseLoan.ratePct, (v) => rate(v, "%")), "Steps ±0.25")}
          />
        </Group>

        <Group title={ppor ? "Ownership costs" : "Rent and costs"}>
          {!ppor && i.rent && (
            <>
              <Control id="as-rent" label="Weekly rent" prefix="$" suffix="/wk" value={draft.rent} onChange={(v) => set("rent", v)} onStep={step("rent", 25, 0)} readOnly={ro} changed={flags.rent} mark={markOf(ws, s, "rent.weeklyCents", "scenario.expectedWeeklyRent")} note={join(baseNote((x) => x.rent?.weeklyCents ?? null, money), "Steps ±$25")} />
              <Control id="as-vacant" label="Vacant weeks" suffix="wks/yr" value={draft.vacant} onChange={(v) => set("vacant", v)} onStep={step("vacant", 1, 0, 0, 52)} readOnly={ro} changed={flags.vacant} mark={markOf(ws, s, "rent.vacantWeeks", "scenario.vacantWeeks")} note={baseNote((x) => x.rent?.vacantWeeks ?? null, String) ?? "Weeks without a tenant each year"} />
            </>
          )}
          <Control id="as-opcosts" label={ppor ? "Ownership costs" : "Operating costs"} prefix="$" suffix="/yr" value={money(sumCosts(i.operatingCosts)).replace("$", "").replace("—", "")} placeholder="—" readOnly changed={flags.opcosts} mark={markOf(ws, s, "operatingCosts", "scenario.annualOperatingCosts")} note={join(baseNote((x) => sumCosts(x.operatingCosts), money), "Management, rates, insurance, maintenance · edit in the profile")} />
          {canEdit && <Control id="as-extra" label="Extra annual cost" prefix="$" suffix="/yr" value={draft.extraCost} onChange={(v) => set("extraCost", v)} placeholder="e.g. 3,000" changed={flags.extra} note="Repairs or other costs, added as an assumption" />}
        </Group>

        <div className="flex flex-col gap-1.5 pt-2">
          <span id="as-rep-label" className="text-[13px] font-medium text-ink-secondary">
            Repayment type {flags.repayment && <span className="text-accent">●</span>}
          </span>
          <div className={cx("[&>div]:flex [&>div]:w-full [&>div>button]:flex-1", ro && "pointer-events-none opacity-70")}>
            <Segmented<string>
              label="Repayment type"
              value={draft.repayment}
              onChange={(v) => canEdit && set("repayment", v as RepaymentType)}
              options={[
                { value: "interest_only", label: "Interest-only" },
                { value: "principal_and_interest", label: "P&I" },
              ]}
            />
          </div>
          <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
            {i.equityDraw ? "Both new loans" : "Purchase loan"} · {termYears} · <Mark kind={markOf(ws, s, "purchaseLoan.repayment", "finance.repaymentType").kind} small />
          </span>
        </div>

        {canEdit && changes.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 border-t border-line-soft pt-3">
            <span className="text-xs text-muted">
              {changes.length} change{changes.length === 1 ? "" : "s"} to {s.name} · will be named “{nameFor(changes)}”
            </span>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => onRun(changes, nameFor(changes))}>
                Run as new scenario
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(own)}>
                Discard edits
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
