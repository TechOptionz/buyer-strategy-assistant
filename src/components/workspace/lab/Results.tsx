"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, cx, Mark } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { MetricDelta } from "@/lib/finance/compare";
import { money, pct, pts, rate } from "@/lib/format";
import { useWs } from "../context";
import { get, inputsOf, labelFor, resultOf, sourceFor, type Scn } from "../derive";
import { inputDiffRows, labelForInput, REPAYMENT_LABEL } from "./shared";

/* ─────────────────────────────── Answer sentence ─────────────────────────────── */

const B = ({ children }: { children: ReactNode }) => <span className="font-semibold">{children}</span>;

export function Answer({ s, refScn }: { s: Scn; refScn: Scn | null }) {
  const i = inputsOf(s);
  const r = resultOf(s);
  const ppor = i.purpose === "ppor";
  // Lead with the reference (base) when there is one, then the selected scenario — as in the design.
  const lead = refScn ?? s;
  const li = inputsOf(lead);
  const lr = resultOf(lead);
  const leadName = lead.kind === "base" ? "the base case" : lead.name;
  const repay = li.purchaseLoan.repayment ? REPAYMENT_LABEL[li.purchaseLoan.repayment].toLowerCase().replace("p&i", "principal-and-interest") : "";
  const at =
    li.purchasePriceCents != null && li.purchaseLoan.principalCents != null && li.purchaseLoan.ratePct != null ? (
      <>
        At <B>{money(li.purchasePriceCents)}</B> with a {money(li.purchaseLoan.principalCents)} {repay} loan at {rate(li.purchaseLoan.ratePct)},{" "}
      </>
    ) : null;

  let sentence: ReactNode;
  if (ppor) {
    const a = lr.cashflow.annualOwnershipCostCents;
    const b = r.cashflow.annualOwnershipCostCents;
    sentence =
      a == null ? (
        <>The annual ownership cost is incomplete — some inputs are still missing.</>
      ) : (
        <>
          {at}
          {at ? leadName : leadName.charAt(0).toUpperCase() + leadName.slice(1)} costs <B>{money(a)}/yr</B> to own (repayments plus ownership costs, avg {money(Math.round(a / 12))}/mo).
          {refScn && b != null && b !== a && (
            <>
              {" "}
              In {caseName(s)} it {b > a ? "rises" : "falls"} to <B>{money(b)}/yr</B>.
            </>
          )}
        </>
      );
  } else {
    const a = lr.cashflow.averageMonthlyCashflowCents;
    const b = r.cashflow.averageMonthlyCashflowCents;
    const hold = (c: number) => (c < 0 ? <>costs an average of <B>{money(-c)}/mo</B> to hold before tax</> : <>returns an average of <B>{money(c)}/mo</B> before tax</>);
    sentence =
      a == null ? (
        <>Monthly cashflow is incomplete — some inputs are still missing.</>
      ) : (
        <>
          {at}
          {at ? leadName : leadName.charAt(0).toUpperCase() + leadName.slice(1)} {hold(a)}.
          {refScn && b != null && b !== a && (
            <>
              {" "}
              In {caseName(s)}{" "}
              {a < 0 && b < 0 ? (
                <>
                  it {b < a ? "rises" : "falls"} to <B>{money(-b)}/mo</B>.
                </>
              ) : (
                <>it {hold(b)}.</>
              )}
            </>
          )}
        </>
      );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[900px] text-base leading-[1.45] font-medium text-pretty text-ink md:text-lg">{sentence}</p>
      <span className="text-xs text-ink-secondary">
        Indicative only — not loan approval
        {!r.financeConfirmed && (
          <>
            {" "}
            · <span className="text-warn">⚠︎ Finance not confirmed</span>
          </>
        )}{" "}
        · Excludes tax effects
      </span>
    </div>
  );
}

/** "the downside case (rate 8.00%, rent $540, 4 vacant wks)" rather than "Rate 8.00%, rent $540…". */
function caseName(s: Scn) {
  const kind = s.kind === "downside" ? "the downside case" : s.kind === "base" ? "the recalculated base case" : s.kind === "upside" ? "the upside case" : "the alternative";
  const detail = s.name.replace(/^(base case|downside|upside)\s*[·—-]?\s*/i, "").trim();
  return detail ? `${kind} (${detail.charAt(0).toLowerCase()}${detail.slice(1)})` : kind;
}

/* ─────────────────────────────── Key figures ─────────────────────────────── */

export function KeyFigures({ s, refScn, stale }: { s: Scn; refScn: Scn | null; stale: boolean }) {
  const i = inputsOf(s);
  const r = resultOf(s);
  const b = refScn ? resultOf(refScn) : null;
  const ppor = i.purpose === "ppor";
  const base = (c: number | null | undefined, unit = "") => (b ? `Base ${c == null ? "—" : `${money(c)}${unit}`}` : null);
  const figures: { label: string; value: number | null; unit: string; sub: ReactNode }[] = [
    { label: "Cash required at settlement", value: r.funding.cashRequiredCents, unit: "", sub: r.funding.availableFundingCents != null ? `of ${money(r.funding.availableFundingCents)} funding available` : "Funding available unknown" },
    { label: "Annual debt service", value: r.cashflow.annualIncrementalDebtServiceCents, unit: "/yr", sub: base(b?.cashflow.annualIncrementalDebtServiceCents, "/yr") ?? (i.equityDraw ? "Purchase loan + equity release" : "Purchase loan") },
    ppor
      ? { label: "Annual ownership cost", value: r.cashflow.annualOwnershipCostCents, unit: "/yr", sub: base(b?.cashflow.annualOwnershipCostCents, "/yr") ?? "Repayments plus ownership costs" }
      : { label: "Collected rent", value: r.cashflow.collectedAnnualRentCents, unit: "/yr", sub: base(b?.cashflow.collectedAnnualRentCents, "/yr") ?? "After vacancy" },
    ppor
      ? { label: "Cash remaining incl. reserve", value: r.funding.cashRemainingIncludingReserveCents, unit: "", sub: base(b?.funding.cashRemainingIncludingReserveCents) ?? "After settlement" }
      : {
          label: "Annual cashflow",
          value: r.cashflow.annualIncrementalCashflowCents,
          unit: "/yr",
          sub: [r.cashflow.averageMonthlyCashflowCents != null ? `avg ${money(r.cashflow.averageMonthlyCashflowCents)}/mo` : null, b ? `base ${money(b.cashflow.annualIncrementalCashflowCents)}/yr` : null].filter(Boolean).join(" · ") || "Before tax",
        },
  ];
  return (
    <div className={cx("grid grid-cols-2 rounded-lg border border-line bg-surface lg:grid-cols-4", stale && "opacity-55")}>
      {figures.map((f, idx) => (
        <div key={f.label} className={cx("flex flex-col gap-1 border-line-soft px-4 py-4 md:px-5", idx % 2 === 0 && "border-r", idx < 2 && "max-lg:border-b", "lg:border-r lg:last:border-r-0")}>
          <span className="text-xs text-ink-secondary">{f.label}</span>
          {f.value == null ? (
            <span className="text-xl leading-[1.2] font-semibold text-muted md:text-[26px]">Incomplete</span>
          ) : (
            <span className="num text-xl leading-[1.2] font-semibold whitespace-nowrap text-ink md:text-[26px]">
              {money(f.value)}
              <span className="text-[13px] font-normal text-ink-secondary">{f.unit}</span>
            </span>
          )}
          {stale ? <Mark kind="stale" small /> : <span className="text-xs text-muted">{f.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────── Alerts ─────────────────────────────── */

/**
 * Check labels name the condition being tested ("Cash required is covered by available funding"),
 * which reads correctly after "✓ Passed" but backwards in a failure box. Say what went wrong instead.
 */
function failureText(c: ReturnType<typeof resultOf>["checks"][number], i: ReturnType<typeof inputsOf>, r: ReturnType<typeof resultOf>): { title: string; body: string } {
  const f = r.funding;
  switch (c.key) {
    case "funding":
      return {
        title: `Funding shortfall of ${f.fundingSurplusCents != null ? money(Math.abs(f.fundingSurplusCents)) : "an unknown amount"}`,
        body: `Cash required at settlement (${money(f.cashRequiredCents)}) is more than the funding available excluding the protected reserve (${money(f.availableFundingCents)}).`,
      };
    case "borrowing_limit": {
      const lim = i.borrowingLimit?.amountCents ?? null;
      const used = (i.purchaseLoan.principalCents ?? 0) + (i.borrowingLimit?.scope === "includes_equity_draw" ? (i.equityDraw?.principalCents ?? 0) : 0);
      return { title: "Borrowing exceeds the client’s borrowing limit", body: `Loans of ${money(used)} against a limit of ${money(lim)}${lim != null ? ` (${money(used - lim)} over)` : ""}.` };
    }
    case "equity_headroom":
      return { title: "Equity release exceeds the theoretical headroom", body: `Equity release of ${money(i.equityDraw?.principalCents ?? null)} against headroom of ${money(f.theoreticalHeadroomCents)}.` };
    case "new_lvr":
      return { title: `New property LVR of ${pct(f.newPropertyLvrPct)} is above the ${i.purchaseLvrCapPct}% cap`, body: "" };
    default:
      return { title: `Failed: ${c.label}`, body: "" };
  }
}

export function CheckAlerts({ s }: { s: Scn }) {
  const { ws } = useWs();
  const i = inputsOf(s);
  const r = resultOf(s);
  const limit = get<number>(ws, "goals.comfortableMonthlyContribution");
  const out: ReactNode[] = [];

  if (limit != null) {
    const monthlyCost = i.purpose === "ppor" ? (r.cashflow.annualOwnershipCostCents != null ? Math.round(r.cashflow.annualOwnershipCostCents / 12) : null) : r.cashflow.averageMonthlyCashflowCents != null ? -r.cashflow.averageMonthlyCashflowCents : null;
    if (monthlyCost != null && monthlyCost > limit)
      out.push(
        <Alert key="comfort" tone="bad" title={`${s.name} exceeds the client’s acceptable ${i.purpose === "ppor" ? "monthly contribution" : "shortfall"}`}>
          {i.purpose === "ppor" ? `Average ${money(monthlyCost)}/mo` : `Average ${money(-monthlyCost)}/mo`} against a stated limit of {money(limit)}/mo ({sourceFor(ws, "goals.comfortableMonthlyContribution")}).
          {r.funding.cashRemainingIncludingReserveCents != null && ` Cash remaining is ${money(r.funding.cashRemainingIncludingReserveCents)} including reserve.`}
        </Alert>,
      );
  }
  for (const c of r.checks.filter((c) => c.outcome === "fail")) {
    const { title, body } = failureText(c, i, r);
    out.push(
      <Alert key={c.key} tone="bad" title={title}>
        {[body, c.detail].filter(Boolean).join(" ")}
      </Alert>,
    );
  }
  const caution = r.checks.filter((c) => c.outcome === "warning" || c.outcome === "unresolved");
  if (caution.length || r.funding.conditionalFunding)
    out.push(
      <Alert key="caution" tone="warn" title={`${caution.length + (r.funding.conditionalFunding ? 1 : 0)} check${caution.length + (r.funding.conditionalFunding ? 1 : 0) === 1 ? "" : "s"} need attention`}>
        <ul className="flex flex-col gap-0.5">
          {r.funding.conditionalFunding && <li>Conditional funding — relies on sale proceeds not confirmed as available before settlement.</li>}
          {caution.map((c) => (
            <li key={c.key}>
              {c.outcome === "unresolved" ? "Unresolved" : "Warning"}: {c.label}
              {c.detail && ` — ${c.detail}`}
            </li>
          ))}
        </ul>
      </Alert>,
    );
  const passed = r.checks.filter((c) => c.outcome === "pass");
  return (
    <>
      {out}
      {passed.length > 0 && (
        <p className="text-xs text-muted">
          <span className="text-ok">✓</span> Passed: {passed.map((c) => c.label).join(" · ")}
        </p>
      )}
    </>
  );
}

export function StaleAlert({ s, onRecalc, busy }: { s: Scn; onRecalc: () => void; busy: boolean }) {
  const { ws } = useWs();
  return (
    <div className="flex flex-col gap-2">
      <Alert
        tone="warn"
        icon="↻"
        title="Out of date — recalculate"
        action={
          ws.permissions.canEdit && (
            <Button variant="primary" size="sm" disabled={busy} onClick={onRecalc}>
              Recalculate
            </Button>
          )
        }
      >
        {s.staleBecause.slice(0, 6).map(labelFor).join(", ")}
        {s.staleBecause.length > 6 && ` and ${s.staleBecause.length - 6} more`} changed after this scenario was calculated (profile revision {s.profileRevision}). Results below reflect the previous profile.
      </Alert>
      <span className="text-xs text-muted">Previous reviewed snapshots are kept. Recalculating creates a new version.</span>
    </div>
  );
}

/* ─────────────────────────────── Comparison ─────────────────────────────── */

type CompareData = { base: { id: string; name: string }; others: { id: string; name: string; changes: string[]; deltas: MetricDelta[]; explanation: { benefits: string[]; tradeOffs: string[] } }[] };

const PERIOD: Record<string, string> = { grossRent: "/yr", collectedRent: "/yr", noi: "/yr", debtService: "/yr", annualCashflow: "/yr", monthlyCashflow: "/mo", ownershipCost: "/yr" };
const LABEL: Record<string, string> = { debtService: "Annual debt service", annualCashflow: "Annual cashflow", collectedRent: "Collected rent", grossRent: "Scheduled rent", grossYield: "Gross yield", netYield: "Net yield", ownershipCost: "Annual ownership cost" };
const DEFAULT_INV = ["collectedRent", "noi", "grossYield", "netYield", "debtService", "annualCashflow", "monthlyCashflow", "cashRequired", "cashRemaining"];
const DEFAULT_PPOR = ["debtService", "ownershipCost", "cashRequired", "fundingSurplus", "cashRemaining"];

function useComparison(key: string | null) {
  const { ws } = useWs();
  const [state, setState] = useState<{ key: string; data: CompareData | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!key) return;
    let live = true;
    api<CompareData>(`/api/assessments/${ws.assessment.id}/comparisons`, { body: { scenarioIds: key.split(",") } })
      .then((d) => live && setState({ key, data: d, error: null }))
      .catch(() => live && setState({ key, data: null, error: "Could not compare these scenarios." }));
    return () => {
      live = false;
    };
  }, [key, ws.assessment.id]);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !!key && !current };
}

type Row = { key: string; label: string; base: string; alt: string; diff: string; tone: "bad" | "ok" | "muted" | "neutral"; input?: boolean; dim?: boolean };

function deltaRow(d: MetricDelta): Row {
  const per = PERIOD[d.key] ?? "";
  const val = (v: number | string | null) => (v == null ? "—" : d.kind === "money" ? `${money(v as number)}${per}` : pct(v));
  let diff = "—";
  let tone: Row["tone"] = "muted";
  if (d.direction === "same") diff = "No change";
  else if (d.delta != null) {
    const n = Number(d.delta);
    const arrow = n > 0 ? "↑" : "↓";
    const v = d.kind === "money" ? `${money(n, { signed: true })}${per}` : pts(n);
    diff = d.direction === "unknown" ? `${arrow} ${v}` : `${arrow} ${v} · ${d.direction}`;
    tone = d.direction === "worse" ? "bad" : d.direction === "better" ? "ok" : "neutral";
  }
  return { key: d.key, label: LABEL[d.key] ?? d.label, base: val(d.base), alt: val(d.other), diff, tone, dim: d.direction === "same" };
}

const TONE: Record<Row["tone"], string> = { bad: "text-bad", ok: "text-ok", muted: "text-muted", neutral: "text-ink-secondary" };

export function Comparison({ s, refScn }: { s: Scn; refScn: Scn }) {
  const [all, setAll] = useState(false);
  const { data, error, loading } = useComparison(`${refScn.id},${s.id}`);
  const ppor = inputsOf(s).purpose === "ppor";
  const deltas = data?.others[0]?.deltas ?? [];
  const inputRows: Row[] = inputDiffRows(inputsOf(refScn), inputsOf(s)).map((r) => ({
    key: `in-${r.key}`,
    label: r.label,
    base: r.from,
    alt: r.to,
    diff: r.direction === "neutral" ? (r.sign ? `${r.sign > 0 ? "↑" : "↓"} ${r.diff}` : r.diff) : `${r.sign > 0 ? "↑" : "↓"} ${r.diff} · ${r.direction}`,
    tone: r.direction === "worse" ? "bad" : r.direction === "better" ? "ok" : "neutral",
    input: true,
  }));
  const defaults = ppor ? DEFAULT_PPOR : DEFAULT_INV;
  const metricRows = (all ? deltas : defaults.map((k) => deltas.find((d) => d.key === k)).filter((d): d is MetricDelta => !!d)).map(deltaRow);
  const rows = [...inputRows, ...metricRows];
  const explanation = data?.others[0]?.explanation;

  return (
    <section aria-label={`Comparison: ${refScn.name} vs ${s.name}`} className="overflow-hidden rounded-lg border border-line bg-surface">
      {error && (
        <div className="p-4">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      {loading && <p className="px-5 py-4 text-[13px] text-muted">Comparing…</p>}
      {data && (
        <>
          <table className="hidden w-full border-collapse text-[13px] md:table">
            <caption className="sr-only">
              {s.name} compared with {refScn.name}
            </caption>
            <thead>
              <tr className="h-9 border-b border-line bg-subtle text-xs font-medium text-muted">
                <th scope="col" className="w-[32%] px-5 text-left font-medium">
                  Metric
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  {refScn.name}
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  {s.name}
                </th>
                <th scope="col" className="w-[28%] px-5 text-right font-medium">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="h-10 border-b border-line-soft">
                  <th scope="row" className={cx("px-5 py-2 text-left font-normal", r.dim ? "text-muted" : "text-ink-2")}>
                    {r.label}
                  </th>
                  <td className={cx("num px-3 py-2 text-right", r.dim ? "text-muted" : "text-ink")}>{r.base}</td>
                  <td className="px-3 py-1 text-right">
                    <span className={cx("num -mx-1.5 inline-block rounded px-1.5 py-1 font-medium", r.input && "bg-accent-tint", r.dim ? "text-muted" : "text-ink")}>{r.alt}</span>
                  </td>
                  <td className={cx("num px-5 py-2 text-right font-medium", TONE[r.tone])}>{r.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="md:hidden">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3">
                <span className="text-[13px] text-ink-secondary">{r.label}</span>
                <div className="flex items-baseline gap-2">
                  <span className={cx("num flex-1 text-[17px] font-semibold", r.dim ? "text-muted" : "text-ink")}>{r.alt}</span>
                  <span className="text-xs text-muted">
                    {refScn.name} {r.base}
                  </span>
                </div>
                <span className={cx("text-[13px] font-medium", TONE[r.tone])}>{r.diff}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2.5 text-xs text-ink-secondary">
            {deltas.length > defaults.length && (
              <button type="button" className="text-accent hover:text-accent-hover hover:underline" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                {all ? "Show key metrics" : `Show all metrics (${deltas.length})`}
              </button>
            )}
            <span className="text-muted">Changed inputs tinted · difference colour follows what is better or worse for the client</span>
          </div>
          {explanation && (explanation.benefits.length > 0 || explanation.tradeOffs.length > 0) && (
            <div className="grid gap-3 border-t border-line-soft px-5 py-3 text-xs sm:grid-cols-2">
              <div>
                <p className="font-medium text-ok">✓ Better for the client</p>
                <ul className="mt-1 text-ink-secondary">{explanation.benefits.length ? explanation.benefits.map((b) => <li key={b}>{b}</li>) : <li className="text-muted">None</li>}</ul>
              </div>
              <div>
                <p className="font-medium text-bad">✕ Worse for the client</p>
                <ul className="mt-1 text-ink-secondary">{explanation.tradeOffs.length ? explanation.tradeOffs.map((b) => <li key={b}>{b}</li>) : <li className="text-muted">None</li>}</ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ─────────────────────────────── Full results ─────────────────────────────── */

export function FullResults({ s, defaultOpen }: { s: Scn; defaultOpen: boolean }) {
  const i = inputsOf(s);
  const r = resultOf(s);
  const f = r.funding;
  const cf = r.cashflow;
  const ppor = i.purpose === "ppor";
  const m = (c: number | null, unit = "") => (c == null ? <span className="text-muted">Incomplete</span> : `${money(c)}${unit}`);
  // No existing property means there is no equity to measure — that is "none", not missing data.
  const { ws } = useWs();
  const noProperty = !i.existingSecurity && ws.profile.propertyIndexes.length === 0;
  const noneText = (why: string) => <span className="text-muted">— None ({why})</span>;
  const none = noneText("no existing property");
  const noSale = !i.fundingSources.some((src) => src.kind === "sale_proceeds");
  const funding: [string, ReactNode][] = [
    ["Current equity (existing property)", noProperty ? none : m(f.currentEquityCents)],
    ["Theoretical headroom (not an approved limit)", noProperty ? none : m(f.theoreticalHeadroomCents)],
    ["Committed cash", m(f.committedCashCents)],
    ["Usable cash after reserve and earmarks", m(f.usableCashCents)],
    ["Eligible net sale proceeds", noSale ? noneText("no sale planned") : m(f.eligibleSaleProceedsCents)],
    ["Equity draw allocated to settlement", i.equityDraw ? m(f.equityDrawAllocatedCents) : noneText("no equity release")],
    ["Equity draw not allocated (still costs interest)", i.equityDraw ? m(f.equityDrawUnallocatedCents) : noneText("no equity release")],
    ["Funding available (excl. protected reserve)", m(f.availableFundingCents)],
    ["Upfront purchase costs", m(f.upfrontCostsCents)],
    ["Cash required at settlement", m(f.cashRequiredCents)],
    ["Funding surplus / (shortfall)", m(f.fundingSurplusCents)],
    ["Cash remaining incl. reserve", m(f.cashRemainingIncludingReserveCents)],
    ["New property LVR", f.newPropertyLvrPct ? pct(f.newPropertyLvrPct) : <span className="text-muted">Incomplete</span>],
  ];
  const cash: [string, ReactNode][] = [
    ...(ppor
      ? ([["Rental income", <span key="n" className="text-muted">Not modelled for a home</span>]] as [string, ReactNode][])
      : ([
          ["Scheduled annual rent", m(cf.scheduledAnnualRentCents, "/yr")],
          ["Collected annual rent (after vacancy)", m(cf.collectedAnnualRentCents, "/yr")],
          ["Annual operating costs", m(cf.annualOperatingCostsCents, "/yr")],
          ["Net operating income", m(cf.netOperatingIncomeCents, "/yr")],
          ["Gross rental yield", pct(cf.grossRentalYieldPct)],
          ["Net rental yield (before finance and tax)", pct(cf.netRentalYieldPct)],
        ] as [string, ReactNode][])),
    ["Purchase loan repayments", m(cf.purchaseLoanAnnualDebtServiceCents, "/yr")],
    ["Equity loan repayments", i.equityDraw ? m(cf.equityDrawAnnualDebtServiceCents, "/yr") : noneText("no equity release")],
    ["Annual incremental debt service", m(cf.annualIncrementalDebtServiceCents, "/yr")],
    ...(ppor
      ? ([["Annual ownership cost (repayments + costs)", m(cf.annualOwnershipCostCents, "/yr")]] as [string, ReactNode][])
      : ([
          ["Annual incremental cashflow", m(cf.annualIncrementalCashflowCents, "/yr")],
          ["Average monthly cashflow (annual ÷ 12)", m(cf.averageMonthlyCashflowCents, "/mo")],
        ] as [string, ReactNode][])),
  ];
  return (
    <details open={defaultOpen} className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center px-5 py-3.5 text-sm font-semibold text-ink">
        <span className="flex-1">All calculated figures · {s.name}</span>
        <span aria-hidden="true" className="text-ink-secondary group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="grid gap-6 border-t border-line px-5 py-4 lg:grid-cols-2">
        <Rows title="Funds and settlement" rows={funding} />
        <Rows title={ppor ? "Ownership costs (home)" : "Rent and cashflow (first year)"} rows={cash} />
      </div>
    </details>
  );
}

function Rows({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-medium text-muted">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b border-line-soft py-2 text-ink-secondary">{k}</dt>
            <dd className="num border-b border-line-soft py-2 pl-3 text-right font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function MissingInputs({ s }: { s: Scn }) {
  if (!s.missingFields.length) return null;
  return (
    <Alert tone="warn" title="Missing inputs — affected figures show “Incomplete”">
      {s.missingFields.map(labelForInput).join(", ")}. Missing values are never treated as zero.
    </Alert>
  );
}

export function AssumptionsSources({ s }: { s: Scn }) {
  const r = resultOf(s);
  const labels = Object.entries(s.assumptionLabels);
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center px-5 py-3.5 text-sm font-semibold text-ink">
        <span className="flex-1">Assumptions and sources ({labels.length})</span>
        <span aria-hidden="true" className="text-ink-secondary group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="flex flex-col gap-1 border-t border-line px-5 py-4 text-[13px] text-ink-2">
        {labels.map(([k, v]) => (
          <li key={k} className="flex gap-2">
            <Mark kind={/assum|assumption/i.test(v) ? "assumption" : /not confirmed|unavailable|needs a/i.test(v) ? "missing" : "confirmed"} label="" small />
            <span>{v}</span>
          </li>
        ))}
        {r.notes.map((n) => (
          <li key={n} className="text-ink-secondary">
            • {n}
          </li>
        ))}
        <li className="pt-1 text-xs text-muted">
          Calculation version {s.calculationVersion} · input hash <span className="font-mono">{s.inputHash.slice(0, 12)}…</span> · profile revision {s.profileRevision}
        </li>
      </ul>
    </details>
  );
}
