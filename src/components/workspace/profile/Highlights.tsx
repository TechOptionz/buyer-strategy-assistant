"use client";

import { cx, Mark, type MarkKind } from "@/components/ui";
import { money } from "@/lib/format";
import { useWs } from "../context";
import { baseScenario, get, inputsOf, markFor, PURPOSE_SHORT, resultOf, sourceFor } from "../derive";
import { useProfileUi } from "./Row";
import { fmt } from "./util";

type Highlight = { key: string; label: string; value: string; unit?: string; mark: { kind: MarkKind; label?: string }; source: string; onClick?: () => void };

const PRIORITY: Record<string, string> = { growth: "Growth over yield", income: "Yield over growth", balanced: "Balanced growth and yield" };
const INCOMPLETE = { kind: "missing" as MarkKind, label: "Incomplete" };

/** Six key values in one panel (desktop) or a horizontal scroll of 160px cards (mobile). */
export function Highlights() {
  const { ws, goTab } = useWs();
  const ui = useProfileUi();
  const base = baseScenario(ws);
  const res = base ? resultOf(base) : null;
  const inp = base ? inputsOf(base) : null;
  const stale = !!base?.staleBecause.length;
  const calcMark = (v: number | null | undefined) => (v == null ? INCOMPLETE : stale ? { kind: "stale" as MarkKind } : { kind: "calculated" as MarkKind });

  const field = (key: string, label: string, path: string, source?: string): Highlight => {
    const c = ws.profile.confirmed[path];
    const known = c?.state === "value";
    return { key, label, value: known ? fmt(path, c.value) : "—", mark: known || ws.profile.conflicts[path] ? markFor(ws, path) : INCOMPLETE, source: source ?? sourceFor(ws, path), onClick: () => ui.open(path) };
  };

  // Funding available (base scenario)
  const funding = res?.funding.availableFundingCents ?? null;
  const reserve = inp?.protectedReserveCents ?? get<number>(ws, "funds.protectedReserve") ?? null;

  // Borrowing limit
  const scope = get<string>(ws, "finance.limitScope");
  const limitSrc = [scope === "includes_equity_draw" ? "Incl. equity draw" : scope === "purchase_loan_only" ? "Purchase loan only" : null, sourceFor(ws, "finance.borrowingLimit")].filter(Boolean).join(" · ");

  // Total equity: Σ value − debt across existing properties.
  const idx = ws.profile.propertyIndexes;
  let equity: number | null = null;
  let incomplete = false;
  for (const i of idx) {
    const v = get<number>(ws, `properties.${i}.value`);
    const d = get<number>(ws, `properties.${i}.debt`);
    if (v == null || d == null) {
      incomplete = true;
      continue;
    }
    equity = (equity ?? 0) + v - d;
  }
  const equityH: Highlight = {
    key: "equity",
    label: "Total equity",
    value: equity == null ? "—" : money(equity),
    mark: equity == null ? INCOMPLETE : incomplete ? { kind: "review", label: "Partial" } : { kind: "estimated" },
    source: !idx.length ? (get<number>(ws, "portfolio.propertyCount") === 0 ? "No existing properties" : "No properties recorded") : incomplete ? "Some values or debts missing" : "Client value estimate",
  };

  // Annual cashflow (base scenario) — PPOR shows annual ownership cost instead.
  const ppor = inp?.purpose === "ppor";
  const cf = ppor ? (res?.cashflow.annualOwnershipCostCents ?? null) : (res?.cashflow.annualIncrementalCashflowCents ?? null);

  const purpose = get<string>(ws, "goals.purchasePurpose");
  const priority = get<string>(ws, "goals.incomeVsGrowth");

  const items: Highlight[] = [
    field("price", "Target price", "scenario.targetPrice"),
    {
      key: "funding",
      label: "Funding available",
      value: money(funding),
      mark: calcMark(funding),
      source: !base ? "No scenario yet" : funding == null ? "Base scenario incomplete" : reserve != null ? `Calculated · excl. ${money(reserve)} reserve` : "Calculated · base scenario",
      onClick: base ? () => goTab("scenarios") : undefined,
    },
    field("limit", "Borrowing limit", "finance.borrowingLimit", limitSrc),
    equityH,
    {
      key: "cashflow",
      label: ppor ? "Annual ownership cost" : "Annual cashflow",
      value: money(cf),
      unit: cf == null ? undefined : "/yr",
      mark: calcMark(cf),
      source: !base ? "No scenario yet" : "Base scenario · before tax",
      onClick: base ? () => goTab("scenarios") : undefined,
    },
    {
      key: "goal",
      label: "Goal",
      value: purpose ? (PURPOSE_SHORT[purpose] ?? purpose) : "—",
      mark: purpose ? markFor(ws, "goals.purchasePurpose") : INCOMPLETE,
      source: priority ? (PRIORITY[priority] ?? sourceFor(ws, "goals.incomeVsGrowth")) : sourceFor(ws, "goals.purchasePurpose"),
      onClick: () => ui.open("goals.purchasePurpose"),
    },
  ];

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:gap-0 md:overflow-visible md:rounded-lg md:border md:border-line md:bg-surface md:px-0 md:pb-0">
      {items.map((h) => {
        const Tag = h.onClick ? "button" : "div";
        return (
          <Tag
            key={h.key}
            type={h.onClick ? "button" : undefined}
            onClick={h.onClick}
            className={cx(
              "flex w-40 flex-none flex-col gap-0.5 rounded-lg border border-line bg-surface p-3 text-left md:w-auto md:min-w-0 md:gap-1 md:rounded-none md:border-0 md:border-r md:border-line-soft md:bg-transparent md:px-4 md:py-3.5 md:last:border-r-0",
              h.onClick && "cursor-pointer hover:bg-subtle",
            )}
          >
            <span className="text-xs text-ink-secondary">{h.label}</span>
            <span className={cx("num truncate text-xl leading-tight font-semibold md:text-[22px]", h.value === "—" ? "text-muted" : "text-ink")}>
              {h.value}
              {h.unit && <span className="text-xs font-normal text-ink-secondary md:text-[13px]">{h.unit}</span>}
            </span>
            <Mark kind={h.mark.kind} label={h.mark.label} />
            <span className="hidden truncate text-[11px] text-muted md:block" title={h.source}>
              {h.source}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
