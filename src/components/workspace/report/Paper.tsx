"use client";

import { useId, useState, type ReactNode } from "react";
import { cx, STATUS_TONE, type Tone } from "@/components/ui";
import { date, money, pct } from "@/lib/format";
import { renderNarrative } from "@/lib/reports/narrative";
import type { SnapshotScenario } from "@/lib/reports/snapshot";
import { type Action, assumedLabels, assumptionRows, engineVersion, type FullReport, isReviewed, keyFigures, pageDomId, reportTitle, ROW, rowDomId, shortHash } from "./model";

/**
 * Saved report values use an ASCII hyphen for negatives because the PDF's built-in font has no
 * true minus glyph. On screen the design's number rules apply: −$9,600, not -$9,600.
 */
function trueMinus(text: string): string {
  return text.replace(/(^|[\s(:])-(?=\$|\d)/g, "$1−");
}

export type FlagFn = (row: string) => { tag: string; current: boolean } | undefined;

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-accent", est: "text-est", neutral: "text-neutral", muted: "text-muted" };
const TONE_ICON: Record<Tone, string> = { ok: "✓", warn: "⚠︎", bad: "✕", info: "→", est: "◐", neutral: "○", muted: "?" };

function OutcomeMark({ status, label }: { status: string; label: string }) {
  const key = status.toLowerCase().replaceAll(" ", "_");
  const tone = STATUS_TONE[key] ?? "muted";
  const icon = key === "partly_meets" ? "◐" : TONE_ICON[tone];
  return (
    <span className={cx("inline-flex items-center gap-1 font-medium whitespace-nowrap", TONE_TEXT[tone])}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

/** A row in the paper. Rows tied to an open review warning get a warn outline and a "1/2" tag in the left margin. */
function Row({ reportId, row, flag, children, className }: { reportId: string; row?: string; flag: FlagFn; children: ReactNode; className?: string }) {
  const f = row ? flag(row) : undefined;
  return (
    <div
      id={row ? rowDomId(reportId, row) : undefined}
      className={cx("relative scroll-mt-24", f && "bg-warn-wash outline-2 outline-warn", f?.current && "outline-offset-1", className)}
    >
      {children}
      {f && (
        <span className="absolute top-[3px] -left-10 rounded-sm border border-warn-line bg-warn-tint px-[3px] text-[9px] font-semibold text-warn">
          <span className="sr-only">Review item </span>
          {f.tag}
        </span>
      )}
    </div>
  );
}

function KV({ label, value, reportId, row, flag }: { label: string; value: string; reportId: string; row?: string; flag: FlagFn }) {
  return (
    <Row reportId={reportId} row={row} flag={flag} className="flex justify-between gap-4 border-b border-line-soft px-1.5 py-[5px]">
      <span>{label}</span>
      <span className="num text-right font-medium text-ink">{typeof value === "string" ? trueMinus(value) : value}</span>
    </Row>
  );
}

const H = ({ children }: { children: ReactNode }) => <h4 className="text-[11px] font-semibold text-ink">{children}</h4>;
const th = "border-b border-line px-1.5 py-1 text-left text-[10px] font-semibold text-muted";
const td = "border-b border-line-soft px-1.5 py-[5px] align-top";

const yr = (c: number | null | undefined) => (c == null ? "—" : `${money(c)}/yr`);

function ScenarioTable({ scenarios }: { scenarios: SnapshotScenario[] }) {
  const rows: [string, (s: SnapshotScenario) => string][] = [
    ["Cash required at settlement", (s) => money(s.result.funding.cashRequiredCents)],
    ["Funding available (excl. reserve)", (s) => money(s.result.funding.availableFundingCents)],
    ["Funding surplus / (shortfall)", (s) => money(s.result.funding.fundingSurplusCents)],
    ["Cash remaining incl. reserve", (s) => money(s.result.funding.cashRemainingIncludingReserveCents)],
    ["New property LVR", (s) => pct(s.result.funding.newPropertyLvrPct)],
    ["Annual incremental debt service", (s) => yr(s.result.cashflow.annualIncrementalDebtServiceCents)],
    ["Collected annual rent", (s) => (s.purpose === "ppor" ? "Not modelled (home)" : yr(s.result.cashflow.collectedAnnualRentCents))],
    ["Annual incremental cashflow", (s) => (s.purpose === "ppor" ? "—" : yr(s.result.cashflow.annualIncrementalCashflowCents))],
    ["Average monthly cashflow", (s) => (s.result.cashflow.averageMonthlyCashflowCents == null ? "—" : `${money(s.result.cashflow.averageMonthlyCashflowCents, { cents: true })}/mo`)],
    ["Annual ownership cost (home)", (s) => yr(s.result.cashflow.annualOwnershipCostCents)],
  ];
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Calculated results per scenario</caption>
      <thead>
        <tr>
          <th scope="col" className={th}>
            Result
          </th>
          {scenarios.map((s, i) => (
            <th key={s.id} scope="col" className={cx(th, "text-right")}>
              {s.name}
              {i === 0 && scenarios.length > 1 ? " (base)" : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, get]) => (
          <tr key={label}>
            <th scope="row" className={cx(td, "text-left font-normal")}>
              {label}
            </th>
            {scenarios.map((s) => (
              <td key={s.id} className={cx(td, "num text-right font-medium text-ink")}>
                {trueMinus(get(s))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NextSteps({ actions, editable, onActions }: { actions: Action[]; editable: boolean; onActions: (a: Action[]) => void }) {
  const uid = useId();
  const [custom, setCustom] = useState("");
  if (!editable) {
    const selected = actions.filter((a) => a.selected);
    return selected.length ? (
      <ol className="flex list-decimal flex-col gap-1 pl-4">
        {selected.map((a) => (
          <li key={a.text}>{a.text}</li>
        ))}
      </ol>
    ) : (
      <p className="text-muted">No next actions selected.</p>
    );
  }
  const add = () => {
    const t = custom.trim();
    if (!t || actions.some((a) => a.text === t)) return;
    onActions([...actions, { text: t, selected: true }]);
    setCustom("");
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-dashed border-accent-line bg-accent-wash p-2.5">
      <legend className="px-1 text-[10px] font-medium text-accent">Next actions · editable — checked actions appear in the report</legend>
      <ul className="flex flex-col gap-1">
        {actions.map((a, i) => {
          const id = `${uid}-act-${i}`;
          return (
            <li key={`${a.text}-${i}`} className="flex items-start gap-2">
              <input id={id} type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]" checked={a.selected} onChange={(e) => onActions(actions.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} />
              <label htmlFor={id} className={cx(!a.selected && "text-muted line-through")}>
                {a.text}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <label htmlFor={`${uid}-custom`} className="sr-only">
          Add a custom action
        </label>
        <input
          id={`${uid}-custom`}
          value={custom}
          maxLength={300}
          placeholder="Add a custom action…"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 text-[11px] text-ink placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent"
        />
        <button type="button" onClick={add} disabled={!custom.trim()} className="h-7 rounded border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink hover:bg-hover disabled:text-faint">
          Add
        </button>
      </div>
    </fieldset>
  );
}

function Extras({ k, report, flag, actions, editable, onActions }: { k: string; report: FullReport; flag: FlagFn; actions: Action[]; editable: boolean; onActions: (a: Action[]) => void }) {
  const { snapshot } = report;
  const rid = report.id;

  if (k === "executive_summary") {
    const figs = keyFigures(snapshot);
    if (!figs.length) return null;
    return (
      <div className="flex flex-col">
        <H>Key figures · {snapshot.scenarios[0]?.name}</H>
        <div className="mt-1 flex flex-col">
          {figs.map((f) => (
            <KV key={f.key} label={f.label} value={f.value} reportId={rid} flag={flag} />
          ))}
        </div>
      </div>
    );
  }

  if (k === "buyer_goals" || k === "financial_overview") {
    const topics = snapshot.profile.filter((t) => (k === "buyer_goals" ? ["Objectives", "Property preferences"].includes(t.topic) : !["Objectives", "Property preferences", "Scenario assumptions"].includes(t.topic)));
    if (!topics.length) return null;
    return (
      <div className="flex flex-col gap-3">
        {topics.map((t) => (
          <div key={t.topic} className="flex flex-col">
            <H>{t.topic}</H>
            <div className="mt-1 flex flex-col">
              {t.items.map((it, i) => (
                <KV key={`${it.label}-${i}`} label={it.label} value={it.value} reportId={rid} row={ROW.profile(t.topic, i)} flag={flag} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (k === "area_comparison") {
    if (!snapshot.areas.length) return <p className="text-muted">Area comparison not included in this report.</p>;
    return (
      <div className="flex flex-col gap-3">
        {snapshot.areas.map((a) => (
          <div key={a.area} className="flex flex-col gap-1">
            <H>
              {a.area}
              {a.excluded ? " — excluded" : ""}
            </H>
            {a.excluded && <p className="text-muted">{a.exclusionReason}</p>}
            {a.criteria.length > 0 && (
              <table className="w-full border-collapse">
                <caption className="sr-only">Fit outcome per criterion for {a.area}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Criterion
                    </th>
                    <th scope="col" className={th}>
                      Outcome
                    </th>
                    <th scope="col" className={th}>
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.criteria.map((c) => (
                    <tr key={c.label}>
                      <th scope="row" className={cx(td, "text-left font-normal")}>
                        {c.label}
                      </th>
                      <td className={td}>
                        <OutcomeMark status={c.outcome} label={c.outcome} />
                      </td>
                      <td className={td}>{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {a.missingEvidence.length > 0 && <p className="text-[10px] text-warn">⚠︎ No evidence yet: {a.missingEvidence.join(", ")}</p>}
          </div>
        ))}
      </div>
    );
  }

  if (k === "purchase_scenarios") {
    if (!snapshot.scenarios.length) return <p className="text-muted">No scenarios were included in this report.</p>;
    return (
      <div className="flex flex-col gap-3">
        <ScenarioTable scenarios={snapshot.scenarios} />
        {snapshot.scenarios.map((sc) => (
          <div key={sc.id} className="flex flex-col gap-1">
            <H>{sc.name}: checks</H>
            <ul className="flex flex-col gap-0.5">
              {sc.result.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  <span className="w-[86px] flex-none">
                    <OutcomeMark status={c.outcome} label={c.outcome.charAt(0).toUpperCase() + c.outcome.slice(1).replaceAll("_", " ")} />
                  </span>
                  <span>
                    {c.label}
                    {c.detail ? <span className="text-muted"> — {c.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (k === "downside_cases") {
    if (!snapshot.comparisons.length) return null;
    return (
      <div className="flex flex-col gap-3">
        {snapshot.comparisons.map((c) => (
          <div key={c.name} className="flex flex-col gap-1">
            <H>
              {c.name} vs {c.against}
            </H>
            <ul className="flex flex-col gap-0.5">
              {c.tradeOffs.map((t) => (
                <li key={`t-${t}`}>
                  <span className="font-medium text-warn">Trade-off:</span> {t}
                </li>
              ))}
              {c.benefits.map((b) => (
                <li key={`b-${b}`}>
                  <span className="font-medium text-ok">Benefit:</span> {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (k === "assumptions") {
    const flagged = assumedLabels(snapshot);
    const rows = assumptionRows(snapshot);
    const scenarioTopic = snapshot.profile.find((t) => t.topic === "Scenario assumptions");
    return (
      <div className="flex flex-col gap-3">
        {scenarioTopic && (
          <div className="flex flex-col">
            <H>Scenario inputs</H>
            <div className="mt-1 flex flex-col">
              {scenarioTopic.items.map((it, i) => (
                <KV key={`${it.label}-${i}`} label={it.label} value={it.value} reportId={rid} flag={flag} />
              ))}
            </div>
          </div>
        )}
        {snapshot.scenarios.map((sc, si) => (
          <div key={sc.id} className="flex flex-col">
            <H>{sc.name}</H>
            <div className="mt-1 flex flex-col">
              {rows
                .filter((r) => r.scenario === sc.name)
                .map((r, i) => {
                  const fi = si === 0 ? flagged.indexOf(r.text) : -1;
                  return (
                    <Row key={`${r.text}-${i}`} reportId={rid} row={fi >= 0 ? ROW.assumption(fi) : undefined} flag={flag} className="border-b border-line-soft px-1.5 py-[5px]">
                      {r.text}
                    </Row>
                  );
                })}
            </div>
            <span className="mt-1 text-[10px] text-muted">
              Calculation engine v{sc.calculationVersion} · profile revision {sc.profileRevision}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (k === "next_steps") return <NextSteps actions={actions} editable={editable} onActions={onActions} />;
  return null;
}

export interface PaperProps {
  report: FullReport;
  reviewerName: string | null;
  editable: boolean;
  commentaryFor: (key: string, orig: string) => string;
  onCommentary: (key: string, v: string) => void;
  actions: Action[];
  onActions: (a: Action[]) => void;
  goScenarios: () => void;
  flag: FlagFn;
}

/** The PDF preview: one 600px paper page per report section. */
export function Paper({ report, reviewerName, editable, commentaryFor, onCommentary, actions, onActions, goScenarios, flag }: PaperProps) {
  const uid = useId();
  const { snapshot, sections } = report;
  const reviewed = isReviewed(report.status);
  const total = sections.sections.length;
  const engine = engineVersion(snapshot);
  const areaNames = snapshot.areas.filter((a) => !a.excluded).map((a) => a.area);
  const rid = report.id;

  return (
    <article aria-label={`Report preview, version ${report.version}`} className="flex flex-col items-center gap-6">
      {sections.sections.map((sec, i) => {
        const commentaryId = `${uid}-com-${sec.key}`;
        const commentary = commentaryFor(sec.key, sec.commentary);
        const first = i === 0;
        const last = i === total - 1;
        return (
          <section
            key={sec.key}
            id={pageDomId(rid, sec.key)}
            data-page={i}
            aria-labelledby={`${uid}-h-${sec.key}`}
            className="relative flex min-h-[848px] w-[600px] scroll-mt-6 flex-col gap-4 bg-surface px-12 py-11 text-[11px] leading-[1.55] text-ink-2 shadow-[var(--shadow-page)]"
          >
            {!reviewed ? (
              <div className="absolute top-[18px] right-5 rounded-sm border border-warn px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-warn">DRAFT v{report.version} — NOT REVIEWED</div>
            ) : report.status === "superseded" ? (
              <div className="absolute top-[18px] right-5 rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-muted">v{report.version} — SUPERSEDED</div>
            ) : null}

            {first && (
              <>
                <div className="flex items-end justify-between gap-4 border-b border-ink pb-2.5">
                  <span className="text-[11px] font-semibold">{snapshot.brandName}</span>
                  <span className="text-right text-[9px] text-muted">
                    Prepared {date(snapshot.generatedAt)} · {snapshot.agentName}
                    {reviewed && report.reviewedAt ? ` · Reviewed ${date(report.reviewedAt)}${reviewerName ? ` by ${reviewerName}` : ""}` : ""}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[20px] leading-[1.25] font-semibold text-ink">{reportTitle(snapshot)}</span>
                  <span className="text-xs">
                    {snapshot.buyerDisplayName}
                    {areaNames.length ? ` · ${areaNames.join(", ")}` : ""}
                  </span>
                </div>
                <Row reportId={rid} row={ROW.disclaimer} flag={flag} className="border border-line-strong px-2.5 py-2 text-[10px]">
                  <strong className="font-semibold">Indicative only — not loan approval.</strong> Not a lender’s assessment, loan approval, or financial, tax or legal advice.
                  {!snapshot.financeConfirmed && " Finance has not been confirmed by a pre-approval or formal approval, so serviceability is not established."}
                </Row>
              </>
            )}

            {!first && <span className="text-[9px] text-muted">{snapshot.buyerDisplayName} · {reportTitle(snapshot)}</span>}

            <div className="flex flex-col gap-1.5">
              <h3 id={`${uid}-h-${sec.key}`} className="text-xs font-semibold text-ink">
                {sec.title}
              </h3>
              <p className="m-0 whitespace-pre-line">{trueMinus(renderNarrative(sec.narrative, snapshot.values))}</p>
            </div>

            <Extras k={sec.key} report={report} flag={flag} actions={actions} editable={editable} onActions={onActions} />

            {editable ? (
              <div className="flex flex-col gap-1.5 rounded border border-dashed border-accent-line bg-accent-wash p-2.5">
                <label htmlFor={commentaryId} className="text-[10px] font-medium text-accent">
                  Agent commentary · editable
                </label>
                <textarea
                  id={commentaryId}
                  value={commentary}
                  maxLength={5000}
                  placeholder={`Add commentary for “${sec.title}”…`}
                  aria-describedby={`${commentaryId}-hint`}
                  onChange={(e) => onCommentary(sec.key, e.target.value)}
                  className="min-h-16 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-[11px] leading-[1.55] text-ink placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent"
                />
                <p id={`${commentaryId}-hint`} className="text-[10px] text-muted">
                  Figures are calculated and can’t be edited here. To change a figure,{" "}
                  <button type="button" className="text-accent hover:underline" onClick={goScenarios}>
                    recalculate in the Scenario lab
                  </button>{" "}
                  and create a new version.
                </p>
              </div>
            ) : (
              commentary && (
                <blockquote className="border-l-2 border-line-strong pl-2.5">
                  <span className="font-medium text-ink">Agent commentary: </span>
                  {commentary}
                </blockquote>
              )
            )}

            {last && (
              <>
                <Row reportId={rid} row={ROW.unresolved} flag={flag} className="flex flex-col gap-1">
                  <H>Not concluded in this report</H>
                  {snapshot.unresolved.length ? (
                    <ul className="flex list-disc flex-col gap-0.5 pl-4">
                      {snapshot.unresolved.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-muted">Every conclusion in this report has the inputs it needs.</p>
                  )}
                </Row>
                {snapshot.evidence.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <H>Evidence sources</H>
                    <Row reportId={rid} row={snapshot.evidence.some((e) => e.isSample) ? ROW.evidenceSample : undefined} flag={flag}>
                      <table className="w-full border-collapse text-[10px]">
                        <caption className="sr-only">Market evidence used in this report</caption>
                        <thead>
                          <tr>
                            <th scope="col" className={th}>
                              Area · metric
                            </th>
                            <th scope="col" className={cx(th, "text-right")}>
                              Value
                            </th>
                            <th scope="col" className={th}>
                              Period to
                            </th>
                            <th scope="col" className={th}>
                              Source
                            </th>
                            <th scope="col" className={th}>
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.evidence.map((e) => (
                            <tr key={e.id}>
                              <th scope="row" className={cx(td, "text-left font-normal")}>
                                {e.area} · {e.metric}
                                <span className="block text-muted">{e.propertyType}</span>
                              </th>
                              <td className={cx(td, "num text-right font-medium text-ink")}>{trueMinus(e.value)}</td>
                              <td className={td}>{date(e.period)}</td>
                              <td className={td}>
                                {e.source}
                                <span className="block font-mono text-[9px] text-muted">{e.id.slice(0, 8)}</span>
                              </td>
                              <td className={td}>
                                <span className={cx("block whitespace-nowrap", e.stale ? "text-warn" : "text-ok")}>
                                  {e.stale ? "↻ Stale" : "✓ Current"} · {e.ageDays} d
                                </span>
                                {e.isSample && <span className="block font-semibold whitespace-nowrap text-bad">Sample data</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Row>
                    {snapshot.attribution && <p className="text-[10px] text-muted">{snapshot.attribution}</p>}
                  </div>
                )}
              </>
            )}

            {snapshot.reportFooter && <span className="mt-auto pt-2 text-center text-[9px] text-muted">{snapshot.reportFooter}</span>}
            <span className={cx("pt-2 text-[9px] text-muted", !snapshot.reportFooter && "mt-auto")}>
              Snapshot {shortHash(report.snapshotHash)}
              {engine ? ` · calculation engine v${engine}` : ""} · page {i + 1} of {total}
            </span>
          </section>
        );
      })}
    </article>
  );
}
