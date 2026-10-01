import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatAUD } from "../parse/numbers";
import { renderNarrative } from "./narrative";
import type { ReportSnapshot } from "./snapshot";
import type { ReportSections } from "../services/reports";

/** A4 page height in PDF points. */
const A4_HEIGHT = 841.89;

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontSize: 9.5, fontFamily: "Helvetica", color: "#1d2733", lineHeight: 1.4 },
  brand: { fontSize: 9, color: "#5b6b7c", marginBottom: 4 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 6, lineHeight: 1.25 },
  sub: { fontSize: 9, color: "#5b6b7c", marginBottom: 10 },
  banner: { padding: 6, marginBottom: 10, borderWidth: 1, borderColor: "#b45309", color: "#7c2d12", backgroundColor: "#fff7ed" },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4, color: "#12324a" },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 },
  p: { marginBottom: 4 },
  commentary: { marginBottom: 4, paddingLeft: 6, borderLeftWidth: 2, borderLeftColor: "#94a3b8", color: "#334155" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d6dde5", paddingVertical: 2 },
  cellLabel: { width: "45%", paddingRight: 6 },
  cell: { flex: 1, paddingRight: 4 },
  th: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: "#5b6b7c" },
  // Anchored from the top: react-pdf misplaces bottom-anchored fixed elements on wrapping pages
  // (each page pushes the footer further below the page edge, so it never appears).
  footer: { position: "absolute", top: A4_HEIGHT - 52, left: 40, right: 40, fontSize: 7.5, color: "#5b6b7c", textAlign: "center" },
});

const money = (c: number | null) => (c == null ? "Incomplete" : formatAUD(c));

function ScenarioTable({ snapshot }: { snapshot: ReportSnapshot }) {
  const rows: [string, (i: number) => string][] = [
    ["Cash required at settlement", (i) => money(snapshot.scenarios[i].result.funding.cashRequiredCents)],
    ["Funding available (excl. reserve)", (i) => money(snapshot.scenarios[i].result.funding.availableFundingCents)],
    ["Funding surplus / (shortfall)", (i) => money(snapshot.scenarios[i].result.funding.fundingSurplusCents)],
    ["Cash remaining incl. reserve", (i) => money(snapshot.scenarios[i].result.funding.cashRemainingIncludingReserveCents)],
    ["New property LVR", (i) => snapshot.scenarios[i].result.funding.newPropertyLvrPct ? `${snapshot.scenarios[i].result.funding.newPropertyLvrPct}%` : "Incomplete"],
    ["Annual incremental debt service", (i) => money(snapshot.scenarios[i].result.cashflow.annualIncrementalDebtServiceCents)],
    ["Collected annual rent", (i) => (snapshot.scenarios[i].purpose === "ppor" ? "Not modelled (PPOR)" : money(snapshot.scenarios[i].result.cashflow.collectedAnnualRentCents))],
    ["Annual incremental cashflow", (i) => (snapshot.scenarios[i].purpose === "ppor" ? "—" : money(snapshot.scenarios[i].result.cashflow.annualIncrementalCashflowCents))],
    ["Average monthly cashflow", (i) => (snapshot.scenarios[i].result.cashflow.averageMonthlyCashflowCents == null ? "—" : formatAUD(snapshot.scenarios[i].result.cashflow.averageMonthlyCashflowCents, { cents: true }))],
    ["Annual ownership cost (PPOR)", (i) => (snapshot.scenarios[i].purpose === "ppor" ? money(snapshot.scenarios[i].result.cashflow.annualOwnershipCostCents) : "Not applicable")],
  ];
  return (
    <View>
      <View style={s.row}>
        <Text style={[s.cellLabel, s.th]}>Result</Text>
        {snapshot.scenarios.map((sc) => (
          <Text key={sc.id} style={[s.cell, s.th]}>{sc.name}</Text>
        ))}
      </View>
      {rows.map(([label, get]) => (
        <View key={label} style={s.row} wrap={false}>
          <Text style={s.cellLabel}>{label}</Text>
          {snapshot.scenarios.map((sc, i) => (
            <Text key={sc.id} style={s.cell}>{get(i)}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function ReportDocument({ snapshot, sections, status, version, reviewedAt, reviewerName }: { snapshot: ReportSnapshot; sections: ReportSections; status: string; version: number; reviewedAt: string | null; reviewerName: string | null }) {
  const reviewed = status === "reviewed" || status === "superseded";
  return (
    <Document title={`${snapshot.brandName} — Buyer assessment — ${snapshot.buyerDisplayName}`} author={snapshot.brandName}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>{snapshot.brandName}</Text>
        <Text style={s.h1}>Buyer assessment: {snapshot.buyerDisplayName}</Text>
        <Text style={s.sub}>
          Version {version} · Prepared by {snapshot.agentName} · {reviewed ? `Reviewed ${reviewedAt ? new Date(reviewedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane" }) : ""}${reviewerName ? ` by ${reviewerName}` : ""}` : "DRAFT — not reviewed"}
        </Text>
        {!reviewed && <Text style={s.banner}>DRAFT. This report has not been reviewed and must not be relied on.</Text>}
        <Text style={s.banner}>
          Indicative assessment only — not a lender&apos;s assessment, loan approval, or financial, tax or legal advice.{" "}
          {snapshot.financeConfirmed ? "Finance status recorded by the agent." : "Finance is NOT confirmed; serviceability is not established."}
        </Text>

        {sections.sections.map((sec) => (
          <View key={sec.key}>
            <Text style={s.h2}>{sec.title}</Text>
            <Text style={s.p}>{renderNarrative(sec.narrative, snapshot.values)}</Text>
            {sec.commentary ? <Text style={s.commentary}>Agent commentary: {sec.commentary}</Text> : null}

            {sec.key === "buyer_goals" &&
              snapshot.profile
                .filter((t) => ["Objectives", "Property preferences"].includes(t.topic))
                .map((t) => (
                  <View key={t.topic}>
                    <Text style={s.h3}>{t.topic}</Text>
                    {t.items.map((i) => (
                      <View key={i.label} style={s.row} wrap={false}>
                        <Text style={s.cellLabel}>{i.label}</Text>
                        <Text style={s.cell}>{i.value}</Text>
                      </View>
                    ))}
                  </View>
                ))}

            {sec.key === "financial_overview" &&
              snapshot.profile
                .filter((t) => !["Objectives", "Property preferences", "Scenario assumptions"].includes(t.topic))
                .map((t) => (
                  <View key={t.topic}>
                    <Text style={s.h3}>{t.topic}</Text>
                    {t.items.map((i) => (
                      <View key={i.label} style={s.row} wrap={false}>
                        <Text style={s.cellLabel}>{i.label}</Text>
                        <Text style={s.cell}>{i.value}</Text>
                      </View>
                    ))}
                  </View>
                ))}

            {sec.key === "area_comparison" &&
              snapshot.areas.map((a) => (
                <View key={a.area}>
                  <Text style={s.h3}>{a.area}{a.excluded ? " — excluded" : ""}</Text>
                  {a.excluded && <Text style={s.p}>{a.exclusionReason}</Text>}
                  {a.criteria.map((c) => (
                    <View key={c.label} style={s.row} wrap={false}>
                      <Text style={s.cellLabel}>{c.label}</Text>
                      <Text style={{ width: 70, fontFamily: "Helvetica-Bold" }}>{c.outcome}</Text>
                      <Text style={s.cell}>{c.reason}</Text>
                    </View>
                  ))}
                </View>
              ))}

            {sec.key === "purchase_scenarios" && snapshot.scenarios.length > 0 && (
              <View>
                <ScenarioTable snapshot={snapshot} />
                {snapshot.scenarios.map((sc) => (
                  <View key={sc.id}>
                    <Text style={s.h3}>{sc.name}: checks</Text>
                    {sc.result.checks.map((c) => (
                      <Text key={c.key} style={s.small}>
                        [{c.outcome.toUpperCase()}] {c.label}{c.detail ? ` — ${c.detail}` : ""}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {sec.key === "downside_cases" &&
              snapshot.comparisons.map((c) => (
                <View key={c.name}>
                  <Text style={s.h3}>{c.name} vs {c.against}</Text>
                  {c.tradeOffs.map((t) => <Text key={t} style={s.small}>Trade-off: {t}</Text>)}
                  {c.benefits.map((b) => <Text key={b} style={s.small}>Benefit: {b}</Text>)}
                </View>
              ))}

            {sec.key === "assumptions" && (
              <View>
                {snapshot.scenarios.map((sc) => (
                  <View key={sc.id}>
                    <Text style={s.h3}>{sc.name}</Text>
                    {sc.labels.map((l) => <Text key={l} style={s.small}>• {l}</Text>)}
                    <Text style={s.small}>Calculation version {sc.calculationVersion} · profile revision {sc.profileRevision}</Text>
                  </View>
                ))}
                {snapshot.unresolved.length > 0 && <Text style={s.h3}>Unresolved — conclusions excluded</Text>}
                {snapshot.unresolved.map((u) => <Text key={u} style={s.small}>• {u}</Text>)}
              </View>
            )}

            {sec.key === "next_steps" &&
              sections.nextActions.filter((a) => a.selected).map((a) => <Text key={a.text} style={s.p}>• {a.text}</Text>)}
          </View>
        ))}

        {snapshot.evidence.length > 0 && (
          <View>
            <Text style={s.h2}>Evidence sources</Text>
            {snapshot.evidence.map((e) => (
              <Text key={e.id} style={s.small}>
                {e.area} · {e.metric} ({e.propertyType}): {e.value} · period to {e.period} · {e.source} · {e.ageDays} days old{e.stale ? " (STALE)" : ""}{e.isSample ? " · SAMPLE DATA" : ""} · ref {e.id.slice(0, 8)}
              </Text>
            ))}
            {snapshot.attribution ? <Text style={s.small}>{snapshot.attribution}</Text> : null}
          </View>
        )}
        <View style={s.footer} fixed>
          {snapshot.reportFooter ? <Text style={{ marginBottom: 2 }}>{snapshot.reportFooter}</Text> : null}
          <Text render={({ pageNumber, totalPages }) => `${snapshot.brandName} · ${snapshot.buyerDisplayName} · v${version} · ${reviewed ? "Reviewed" : "DRAFT"} · page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** The built-in PDF font covers WinAnsi only; map characters it cannot draw (a lost minus sign changes meaning). */
const PDF_SAFE: [RegExp, string][] = [
  [/−/g, "-"],
  [/→/g, "to"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/[✓✔]/g, "Yes"],
  [/[✕✖]/g, "No"],
  [/÷/g, "/"],
];
function pdfSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === "string" ? PDF_SAFE.reduce((s, [re, r]) => s.replace(re, r), v) : v));
}

export async function renderReportPdf(args: Parameters<typeof ReportDocument>[0]) {
  return renderToBuffer(<ReportDocument {...args} snapshot={pdfSafe(args.snapshot)} sections={pdfSafe(args.sections)} />);
}
