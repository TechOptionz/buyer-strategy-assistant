"use client";

import { useState, type ReactNode } from "react";
import { cx, Mark, type MarkKind } from "@/components/ui";
import { money, rate } from "@/lib/format";
import { FIELDS, formatValue } from "@/lib/profile/fields";
import { useWs } from "../context";
import { baseScenario, get, inputsOf, markFor } from "../derive";
import { FieldRow, LinkButton, Section, useProfileUi } from "./Row";
import { displayFor, isGap } from "./util";

const PROPERTY_FIELDS = FIELDS.filter((d) => d.path.startsWith("properties."));
const HEAD = "h-8 items-center border-b border-line bg-subtle px-5 text-xs font-medium text-muted";
const PROP_GRID = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:gap-3";
const LOAN_GRID = "md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)] md:gap-3";

/** A numeric table cell: value with a small status mark beneath; opens Value details. */
function NumCell({ path, sub, align = "right" }: { path: string; sub?: ReactNode; align?: "right" | "left" }) {
  const { ws, changed } = useWs();
  const ui = useProfileUi();
  const v = displayFor(ws, path);
  const m = markFor(ws, path);
  return (
    <button
      type="button"
      onClick={() => ui.open(path)}
      className={cx("flex min-w-0 flex-col rounded px-1 py-0.5 hover:bg-subtle", align === "right" ? "items-end text-right" : "items-start text-left", ui.selected === path && "bg-accent-wash")}
    >
      <span className={cx("num max-w-full truncate font-medium", v.muted ? "font-normal text-muted" : "text-ink", changed.has(path) && "just-changed rounded")}>
        {v.text}
        {v.unit && <span className="text-xs font-normal text-ink-secondary">{v.unit}</span>}
      </span>
      {sub ?? <Mark small kind={m.kind} label={m.label} />}
    </button>
  );
}

export function PropertiesSection({ gapsOnly, onAdd }: { gapsOnly: boolean; onAdd?: () => void }) {
  const { ws } = useWs();
  const idx = ws.profile.propertyIndexes;
  const count = get<number>(ws, "portfolio.propertyCount");
  const title = `Existing properties · ${count ?? idx.length}`;
  const actions = onAdd ? <LinkButton onClick={onAdd}>Add property</LinkButton> : undefined;

  if (gapsOnly) {
    const paths = ["portfolio.propertyCount", ...idx.flatMap((i) => PROPERTY_FIELDS.map((d) => d.path.replace("*", String(i))))].filter((p) => isGap(ws, p));
    if (!paths.length) return null;
    return (
      <Section title={title} actions={actions}>
        {paths.map((p) => (
          <FieldRow key={p} path={p} sectionEdit />
        ))}
      </Section>
    );
  }

  return (
    <Section title={title} actions={actions}>
      {(count == null || !idx.length) && <FieldRow path="portfolio.propertyCount" sectionEdit />}
      {idx.length > 0 && (
        <>
          <div className={cx(PROP_GRID, HEAD, "hidden")}>
            <span>Address</span>
            <span>Ownership</span>
            <span className="text-right">Value</span>
            <span className="text-right">Secured debt</span>
            <span className="text-right">Equity</span>
            <span className="text-right">Rent</span>
            <span>Intention</span>
          </div>
          {idx.map((i) => (
            <PropertyRow key={i} i={i} />
          ))}
        </>
      )}
    </Section>
  );
}

function PropertyRow({ i }: { i: number }) {
  const { ws } = useWs();
  const ui = useProfileUi();
  const [open, setOpen] = useState(false);
  const p = (k: string) => `properties.${i}.${k}`;
  const address = get<string>(ws, p("address"));
  const type = get<string>(ws, p("type"));
  const use = get<string>(ws, p("use"));
  const share = get<number>(ws, p("ownershipSharePct"));
  const structure = get<string>(ws, p("ownershipStructure"));
  const value = get<number>(ws, p("value"));
  const debt = get<number>(ws, p("debt"));
  const equity = value != null && debt != null ? value - debt : null;
  const subline = [type ? formatValue(p("type"), type) : null, use === "ppor" ? "home (PPOR)" : use === "investment" ? "investment" : null].filter(Boolean).join(" · ");
  const ownership = [share != null ? `${share}%` : null, structure ? formatValue(p("ownershipStructure"), structure) : null].filter(Boolean).join(" · ") || "—";
  const gaps = PROPERTY_FIELDS.filter((d) => isGap(ws, d.path.replace("*", String(i)))).length;

  return (
    <div className="border-b border-line-soft last:border-b-0">
      {/* Desktop table row */}
      <div className={cx(PROP_GRID, "hidden items-center px-5 py-2.5 text-[13px]")}>
        <button type="button" onClick={() => ui.open(p("address"))} className="flex min-w-0 flex-col rounded px-1 py-0.5 text-left hover:bg-subtle">
          <span className={cx("truncate font-medium", address ? "text-ink" : "text-muted")}>{address ?? `Property ${i}`}</span>
          <span className="truncate text-xs text-muted">{subline || "Type and use not recorded"}</span>
        </button>
        <button type="button" onClick={() => ui.open(p("ownershipStructure"))} className={cx("min-w-0 truncate rounded px-1 py-0.5 text-left hover:bg-subtle", ownership === "—" && "text-muted")}>
          {ownership}
        </button>
        <NumCell path={p("value")} />
        <NumCell path={p("debt")} />
        <div className="flex flex-col items-end px-1 text-right">
          <span className={cx("num font-medium", equity == null ? "font-normal text-muted" : "text-ink")}>{money(equity)}</span>
          <span className="text-[11px] text-muted">{equity == null ? "Needs value and debt" : "Calculated"}</span>
        </div>
        <NumCell path={p("rentWeekly")} sub={use === "ppor" && !ws.profile.confirmed[p("rentWeekly")] ? <span className="text-[11px] text-muted">Owner-occupied</span> : undefined} />
        <NumCell path={p("intention")} align="left" />
      </div>

      {/* Mobile stacked item */}
      <div className="flex flex-col gap-2 px-4 py-3 md:hidden">
        <button type="button" onClick={() => ui.open(p("address"))} className="flex flex-col text-left">
          <span className={cx("text-sm font-medium", address ? "text-ink" : "text-muted")}>{address ?? `Property ${i}`}</span>
          {subline && <span className="text-xs text-muted">{subline}</span>}
        </button>
        <div className="grid grid-cols-3 gap-2 text-xs text-ink-secondary">
          {(
            [
              ["Value", value, p("value")],
              ["Debt", debt, p("debt")],
              ["Equity", equity, null],
            ] as const
          ).map(([k, v, path]) => (
            <button key={k} type="button" disabled={!path} onClick={() => path && ui.open(path)} className="flex flex-col text-left disabled:cursor-default">
              <span>{k}</span>
              <span className={cx("num text-[15px] font-medium", v == null ? "text-muted" : "text-ink")}>{money(v)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-2 md:px-5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-xs text-accent hover:text-accent-hover hover:underline">
          {open ? "Hide property details" : `All property details${gaps ? ` · ${gaps} gap${gaps === 1 ? "" : "s"}` : ""}`}
        </button>
      </div>
      {open && (
        <div className="border-t border-line-soft">
          {PROPERTY_FIELDS.map((d) => (
            <FieldRow key={d.path} path={d.path.replace("*", String(i))} label={d.label} sectionEdit />
          ))}
        </div>
      )}
    </div>
  );
}

type Loan = { key: string; name: string; kind: string; security: string; balance: string; rate: string; repay: string; mark: { kind: MarkKind; label?: string }; onClick: () => void };

export function LoansSection() {
  const { ws, goTab } = useWs();
  const ui = useProfileUi();
  const loans: Loan[] = [];
  const addressOf = (i: number) => get<string>(ws, `properties.${i}.address`) ?? `Property ${i}`;

  for (const i of ws.profile.propertyIndexes) {
    const p = (k: string) => `properties.${i}.${k}`;
    const debtC = ws.profile.confirmed[p("debt")];
    if (debtC?.state === "value" && Number(debtC.value) === 0) continue; // explicit zero debt: no loan
    if (!debtC && !ws.profile.confirmed[p("loanRatePct")] && !ws.profile.confirmed[p("loanRepaymentMonthly")]) continue;
    const use = get<string>(ws, p("use"));
    const r = get<number>(ws, p("loanRatePct"));
    const repay = get<number>(ws, p("loanRepaymentMonthly"));
    const m = markFor(ws, p("debt"));
    loans.push({
      key: `p${i}`,
      name: use === "ppor" ? "Existing home loan" : use === "investment" ? "Existing investment loan" : "Existing loan",
      kind: use === "ppor" ? "Owner-occupied" : use === "investment" ? "Investment" : "Use not recorded",
      security: addressOf(i),
      balance: displayFor(ws, p("debt")).text,
      rate: r == null ? "—" : rate(r),
      repay: repay == null ? "Not provided" : `${money(repay)}/mo`,
      mark: r == null ? { kind: "review", label: "Rate missing" } : m,
      onClick: () => ui.open(r == null ? p("loanRatePct") : p("debt")),
    });
  }

  const base = baseScenario(ws);
  if (base) {
    const inp = inputsOf(base);
    const term = (months: number | null) => (months ? `Proposed · ${Math.round(months / 12)} yrs` : "Proposed");
    const repayLabel = (t: string | null) => (t === "interest_only" ? "Interest-only" : t === "principal_and_interest" ? "Principal and interest" : "—");
    const stale = base.staleBecause.length > 0;
    const mark = stale ? { kind: "stale" as MarkKind } : { kind: "assumption" as MarkKind };
    if (inp.purchaseLoan?.principalCents != null) {
      loans.push({
        key: "purchase",
        name: "Purchase loan",
        kind: term(inp.purchaseLoan.termMonths),
        security: "New property",
        balance: money(inp.purchaseLoan.principalCents),
        rate: rate(inp.purchaseLoan.ratePct),
        repay: repayLabel(inp.purchaseLoan.repayment),
        mark: inp.purchaseLoan.ratePct == null ? { kind: "review", label: "Rate missing" } : mark,
        onClick: () => goTab("scenarios"),
      });
    }
    if (inp.equityDraw?.principalCents != null) {
      const home = ws.profile.propertyIndexes.find((i) => get<string>(ws, `properties.${i}.use`) === "ppor") ?? ws.profile.propertyIndexes[0];
      loans.push({
        key: "equity",
        name: "Equity release",
        kind: term(inp.equityDraw.termMonths),
        security: home != null ? addressOf(home) : "Existing property",
        balance: money(inp.equityDraw.principalCents),
        rate: rate(inp.equityDraw.ratePct),
        repay: repayLabel(inp.equityDraw.repayment),
        mark: inp.equityDraw.ratePct == null ? { kind: "review", label: "Rate missing" } : mark,
        onClick: () => goTab("scenarios"),
      });
    }
  }

  return (
    <Section title="Loans">
      {!loans.length ? (
        <p className="px-4 py-3 text-[13px] text-muted md:px-5">No existing or proposed loans recorded yet. Existing loans come from property debts; proposed loans from the base scenario.</p>
      ) : (
        <>
          <div className={cx(LOAN_GRID, HEAD, "hidden")}>
            <span>Loan</span>
            <span>Secured against</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Rate</span>
            <span>Repayment</span>
            <span>Status</span>
          </div>
          {loans.map((l) => (
            <button key={l.key} type="button" onClick={l.onClick} className="block w-full border-b border-line-soft text-left last:border-b-0 hover:bg-subtle">
              <span className={cx(LOAN_GRID, "hidden min-h-11 items-center px-5 py-2 text-[13px]")}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{l.name}</span>
                  <span className="truncate text-xs text-muted">{l.kind}</span>
                </span>
                <span className="truncate">{l.security}</span>
                <span className="num text-right font-medium">{l.balance}</span>
                <span className={cx("num text-right", l.rate === "—" ? "text-muted" : "text-ink")}>{l.rate}</span>
                <span className={cx(l.repay === "Not provided" || l.repay === "—" ? "text-muted" : "text-ink")}>{l.repay}</span>
                <Mark kind={l.mark.kind} label={l.mark.label} />
              </span>
              <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 md:hidden">
                <span className="text-sm font-medium text-ink">{l.name}</span>
                <span className="num text-right text-[15px] font-medium">{l.balance}</span>
                <span className="text-xs text-muted">
                  {l.kind} · {l.security} · {l.rate}
                </span>
                <span className="text-right">
                  <Mark kind={l.mark.kind} label={l.mark.label} />
                </span>
              </span>
            </button>
          ))}
        </>
      )}
    </Section>
  );
}
