"use client";

import type { ReactNode } from "react";
import { cx, Segmented } from "@/components/ui";
import type { ScenarioChange } from "@/lib/finance/patch";
import type { CostItem, ScenarioInputs } from "@/lib/finance/types";
import { money, MINUS, pts, rate } from "@/lib/format";
import { useWs, type LabView } from "../context";

/** Sub-toolbar shared by both Scenario Lab views: dark Scenarios | Suburbs toggle, then view controls. */
export function LabToolbar({ children, className }: { children?: ReactNode; className?: string }) {
  const { labView, setLabView } = useWs();
  return (
    <div className={cx("flex items-center gap-2 border-b border-line bg-surface px-4 py-3 md:px-8", className)}>
      <div className="mr-2 shrink-0 md:mr-4">
        <Segmented<LabView>
          dark
          label="Scenario Lab view"
          value={labView}
          onChange={setLabView}
          options={[
            { value: "scenarios", label: "Scenarios" },
            { value: "suburbs", label: "Suburbs" },
          ]}
        />
      </div>
      {children}
    </div>
  );
}

/** Dashed "+ Add" chip button used in both toolbars. */
export function DashedChip({ children, onClick, disabled, title, ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; "aria-expanded"?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      className="flex h-[30px] shrink-0 items-center rounded border border-dashed border-line-strong px-3 text-[13px] whitespace-nowrap text-ink-secondary hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────── Scenario input helpers ─────────────────────────────── */

export const sumCosts = (items: CostItem[] | null | undefined): number | null => {
  if (!items || !items.length) return null;
  let t = 0;
  for (const c of items) {
    if (c.amountCents == null) return null;
    t += c.amountCents;
  }
  return t;
};

export const REPAYMENT_LABEL: Record<string, string> = { interest_only: "Interest-only", principal_and_interest: "P&I" };

const signed = (n: number, unit = "") => `${n > 0 ? "+" : n < 0 ? MINUS : ""}${Math.abs(n)}${unit}`;

/** Input fields that a scenario change can move, with display formats (FinancialValue rules). */
export const INPUT_FIELDS = [
  { key: "price", label: "Purchase price", get: (i: ScenarioInputs) => i.purchasePriceCents, fmt: (v: number) => money(v), diff: (d: number) => money(d, { signed: true }), better: 0 },
  { key: "valuation", label: "Lender valuation", get: (i: ScenarioInputs) => i.lenderValuationCents, fmt: (v: number) => money(v), diff: (d: number) => money(d, { signed: true }), better: 0 },
  { key: "loan", label: "Purchase loan", get: (i: ScenarioInputs) => i.purchaseLoan.principalCents, fmt: (v: number) => money(v), diff: (d: number) => money(d, { signed: true }), better: 0 },
  { key: "equity", label: "Equity release", get: (i: ScenarioInputs) => i.equityDraw?.principalCents ?? null, fmt: (v: number) => money(v), diff: (d: number) => money(d, { signed: true }), better: 0 },
  { key: "rate", label: "Interest rate · new loans", get: (i: ScenarioInputs) => i.purchaseLoan.ratePct, fmt: (v: number) => rate(v), diff: (d: number) => pts(d), better: -1 },
  { key: "rent", label: "Weekly rent", get: (i: ScenarioInputs) => i.rent?.weeklyCents ?? null, fmt: (v: number) => `${money(v)}/wk`, diff: (d: number) => `${money(d, { signed: true })}/wk`, better: 1 },
  { key: "vacant", label: "Vacant weeks", get: (i: ScenarioInputs) => i.rent?.vacantWeeks ?? null, fmt: (v: number) => `${v} wks/yr`, diff: (d: number) => `${signed(d)} wks`, better: -1 },
  { key: "opcosts", label: "Operating costs", get: (i: ScenarioInputs) => sumCosts(i.operatingCosts), fmt: (v: number) => `${money(v)}/yr`, diff: (d: number) => `${money(d, { signed: true })}/yr`, better: -1 },
] as const;

export type InputRow = { key: string; label: string; from: string; to: string; diff: string; direction: "better" | "worse" | "neutral"; sign: number };

/** Rows for every input that differs between two input sets (repayment type included). */
export function inputDiffRows(a: ScenarioInputs, b: ScenarioInputs): InputRow[] {
  const rows: InputRow[] = [];
  for (const f of INPUT_FIELDS) {
    const x = f.get(a);
    const y = f.get(b);
    if (x === y) continue;
    if (x == null || y == null) {
      rows.push({ key: f.key, label: f.label, from: x == null ? "—" : f.fmt(x), to: y == null ? "—" : f.fmt(y), diff: "—", direction: "neutral", sign: 0 });
      continue;
    }
    const d = Math.round((y - x) * 10_000) / 10_000;
    if (d === 0) continue;
    const direction = f.better === 0 ? "neutral" : Math.sign(d) === f.better ? "better" : "worse";
    rows.push({ key: f.key, label: f.label, from: f.fmt(x), to: f.fmt(y), diff: f.diff(d), direction, sign: Math.sign(d) });
  }
  const ra = a.purchaseLoan.repayment;
  const rb = b.purchaseLoan.repayment;
  if (ra !== rb) rows.push({ key: "repayment", label: "Repayment type", from: ra ? REPAYMENT_LABEL[ra] : "—", to: rb ? REPAYMENT_LABEL[rb] : "—", diff: "Changed", direction: "neutral", sign: 0 });
  return rows;
}

/** Explanation shown beside a proposed change (what the change means, not just the number). */
export function changeNote(ch: ScenarioChange): string | null {
  switch (ch.op) {
    case "rate_add_pp":
      return `${pts(ch.pp).replace(" pts", " percentage points")} (not a ${Math.abs(ch.pp)}% relative ${ch.pp >= 0 ? "rise" : "fall"})`;
    case "rate_scale_relative_pct":
      return `${signed(ch.pct, "%")} of the current rate (relative change)`;
    case "rent_scale_relative_pct":
      return `${signed(ch.pct, "%")} of the current rent`;
    case "set_price":
      return ch.alsoValuation ? "Lender valuation assumed equal" : null;
    case "set_equity_draw":
      return "Fully allocated to settlement";
    case "add_annual_cost":
      return `Adds “${ch.label}”`;
    default:
      return null;
  }
}

/** Short scenario name fragment for a change: "Rate +2.00 pts", "rent $700". */
export function shortChange(ch: ScenarioChange): string {
  switch (ch.op) {
    case "set_price":
      return `price ${money(ch.cents)}`;
    case "set_valuation":
      return `valuation ${money(ch.cents)}`;
    case "valuation_scale_relative_pct":
      return `valuation ${signed(ch.pct, "%")}`;
    case "set_purchase_loan":
      return `loan ${money(ch.cents)}`;
    case "set_deposit":
      return `deposit ${money(ch.cents)}`;
    case "set_equity_draw":
      return `equity ${money(ch.cents)}`;
    case "rate_add_pp":
      return `rate ${pts(ch.pp)}`;
    case "rate_scale_relative_pct":
      return `rate ${signed(ch.pct, "%")} relative`;
    case "set_rate":
      return `rate ${rate(ch.pct, "%")}`;
    case "set_repayment":
      return REPAYMENT_LABEL[ch.repayment];
    case "set_weekly_rent":
      return `rent ${money(ch.cents)}`;
    case "rent_scale_relative_pct":
      return `rent ${signed(ch.pct, "%")}`;
    case "set_vacant_weeks":
      return `${ch.weeks} vacant wks`;
    case "add_annual_cost":
      return `+${money(ch.cents)}/yr costs`;
  }
}

export function nameFor(changes: ScenarioChange[], prefix?: string) {
  const body = changes.map(shortChange).join(", ");
  const full = prefix ? (body ? `${prefix} · ${body}` : prefix) : body;
  const cap = full.charAt(0).toUpperCase() + full.slice(1);
  return cap.length > 80 ? `${cap.slice(0, 79)}…` : cap || "What-if";
}

export function labelForInput(m: string) {
  const map: Record<string, string> = {
    purchasePriceCents: "Purchase price",
    lenderValuationCents: "Lender valuation",
    "purchaseLoan.principalCents": "Purchase loan amount",
    "purchaseLoan.ratePct": "Interest rate",
    "purchaseLoan.termMonths": "Loan term",
    "purchaseLoan.repayment": "Repayment type",
    "equityDraw.principalCents": "Equity release amount",
    "equityDraw.allocatedCents": "Equity release allocation",
    "equityDraw.ratePct": "Equity loan rate",
    "equityDraw.termMonths": "Equity loan term",
    "equityDraw.repayment": "Equity loan repayment type",
    protectedReserveCents: "Protected cash reserve",
    otherEarmarkedCents: "Earmarked cash",
    "rent.weeklyCents": "Weekly rent",
    "rent.vacancyBasis": "Vacancy assumption",
    purchaseCosts: "Purchase costs",
    operatingCosts: "Operating costs",
    purpose: "Purchase purpose",
  };
  return map[m] ?? m.replace(/^purchaseCosts\[\d+\] /, "").replace(/^operatingCosts\[\d+\] /, "");
}
