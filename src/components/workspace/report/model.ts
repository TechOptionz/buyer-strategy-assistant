"use client";

import type { ReportSnapshot } from "@/lib/reports/snapshot";
import type { ReportSections } from "@/lib/services/reports";

export interface FullReport {
  id: string;
  version: number;
  rowVersion: number;
  status: string;
  snapshot: ReportSnapshot;
  sections: ReportSections;
  snapshotHash: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  changeSummary: string | null;
  narrativeSource: "ai" | "template";
  scope: { areaAssessment: boolean; purchaseBudget: boolean } | null;
  exports: { id: string; createdAt: string; byteSize: number }[];
}

export type Action = { text: string; selected: boolean };

export type ExportState = { reportId: string; phase: "running" | "done" | "failed" | "denied"; status: string; exportId?: string; error?: string };

export type ReviewAction = "submit" | "approve" | "request_changes";

export const MAX_SCENARIOS = 3;
export const isReviewed = (status: string) => status === "reviewed" || status === "superseded";
export const editableStatus = (status: string) => status === "draft" || status === "needs_changes";
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
export const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 6).toUpperCase() : "—");
export const engineVersion = (s: ReportSnapshot) => s.scenarios[0]?.calculationVersion ?? null;

/** DOM id for a page (one per report section) or a flagged row inside the preview. */
export const pageDomId = (reportId: string, key: string) => `rp-${reportId.slice(0, 8)}-${key}`;
export const rowDomId = (reportId: string, row: string) => `rr-${reportId.slice(0, 8)}-${row}`;

/** Rows in the preview that a checklist warning can point at. */
export const ROW = {
  disclaimer: "disclaimer",
  unresolved: "unresolved",
  evidenceSample: "evidence-sample",
  profile: (topic: string, i: number) => `prof-${topic.replace(/\W+/g, "-").toLowerCase()}-${i}`,
  assumption: (i: number) => `asm-${i}`,
};

export interface CheckItem {
  id: string;
  text: string;
  sub: string;
  state: "ok" | "warn";
  /** Wording recorded when a reviewer accepts this warning. */
  acceptAs?: string;
  /** Section key whose page holds the flagged content. */
  page?: string;
  row?: string;
  /** Assumption warnings can be replaced by recalculating in the Scenario lab. */
  replaceable?: boolean;
}

const ASSUMED = /assum|estimat/i;

/** Assumption labels from the base scenario that a reviewer should acknowledge (kept to a few). */
export function assumedLabels(snapshot: ReportSnapshot) {
  const base = snapshot.scenarios[0];
  if (!base) return [];
  return base.labels.filter((l) => ASSUMED.test(l) && !/\(confirmed\)/i.test(l)).slice(0, 3);
}

/** All assumption-like labels for the "Assumptions and limitations" page (flagged ones first). */
export function assumptionRows(snapshot: ReportSnapshot) {
  return snapshot.scenarios.flatMap((sc, si) => [...sc.labels, ...sc.changes.map((c) => `Changed: ${c}`)].map((text) => ({ scenario: sc.name, text, base: si === 0 })));
}

/** Where the "finance not confirmed" warning points: a finance/borrowing row in the financial overview, else the disclaimer. */
function financeTarget(snapshot: ReportSnapshot): { page: string; row: string } {
  for (const t of snapshot.profile) {
    if (["Objectives", "Property preferences", "Scenario assumptions"].includes(t.topic)) continue;
    const i = t.items.findIndex((it) => /borrowing limit|finance/i.test(it.label));
    if (i >= 0) return { page: "financial_overview", row: ROW.profile(t.topic, i) };
  }
  return { page: "executive_summary", row: ROW.disclaimer };
}

export function buildChecklist(report: FullReport): CheckItem[] {
  const { snapshot } = report;
  const items: CheckItem[] = [];
  const facts = snapshot.profile.reduce((n, t) => n + t.items.length, 0);
  const conflicts = snapshot.unresolved.filter((u) => u.startsWith("Conflicting values"));

  items.push(
    conflicts.length
      ? {
          id: "profile",
          state: "warn",
          text: `${conflicts.length} conflicting profile value${conflicts.length === 1 ? "" : "s"} excluded`,
          sub: "Not concluded · accept as excluded until resolved",
          acceptAs: "Conflicting profile values excluded until resolved",
          page: "next_steps",
          row: ROW.unresolved,
        }
      : { id: "profile", state: "ok", text: "Client profile confirmed", sub: `${facts} fact${facts === 1 ? "" : "s"} · profile revision ${snapshot.profileRevision}` },
  );

  const engine = engineVersion(snapshot);
  items.push({ id: "snapshot", state: "ok", text: "Figures match saved snapshot", sub: `Snapshot ${shortHash(report.snapshotHash)}${engine ? ` · engine v${engine}` : ""}` });

  const sample = snapshot.evidence.filter((e) => e.isSample);
  items.push(
    sample.length
      ? {
          id: "sample",
          state: "warn",
          text: "Sample market data in evidence",
          sub: `${sample.length} sample source${sample.length === 1 ? "" : "s"} · Evidence sources`,
          acceptAs: "Sample market data shown as illustrative only",
          page: "next_steps",
          row: ROW.evidenceSample,
        }
      : {
          id: "sample",
          state: "ok",
          text: "Sample market data excluded",
          sub: snapshot.evidence.length ? `${snapshot.evidence.length} dated evidence source${snapshot.evidence.length === 1 ? "" : "s"}` : "No market evidence in this report",
        },
  );

  assumedLabels(snapshot).forEach((label, i) => {
    items.push({
      id: `assume-${i}`,
      state: "warn",
      text: label.replace(/^Assumption:\s*/, ""),
      sub: `${snapshot.scenarios[0]?.name ?? "Scenario"} · scenario assumption`,
      acceptAs: `${label.replace(/^Assumption:\s*/, "")} — accepted as assumption`,
      page: "assumptions",
      row: ROW.assumption(i),
      replaceable: true,
    });
  });

  if (!snapshot.financeConfirmed) {
    const t = financeTarget(snapshot);
    items.push({ id: "finance", state: "warn", text: "Finance not confirmed", sub: "Accept as a stated limitation", acceptAs: "Finance not confirmed — accepted as stated limitation", ...t });
  } else {
    items.push({ id: "finance", state: "ok", text: "Finance confirmed", sub: "Pre-approval or formal approval recorded" });
  }

  const unresolvedLabels = snapshot.unresolved.map((u) => u.split(":")[0].replace(/^Conflicting values recorded for /, "Conflict: ").replace(/ — excluded until resolved$/, ""));
  items.push({
    id: "unresolved",
    state: "ok",
    text: "Unresolved conclusions listed",
    sub: unresolvedLabels.length ? unresolvedLabels.slice(0, 3).join(", ") + (unresolvedLabels.length > 3 ? "…" : "") : "None — every conclusion has its inputs",
  });
  return items;
}

/** Key figures for the executive summary page, from the saved placeholder values of the base scenario. */
export function keyFigures(snapshot: ReportSnapshot) {
  const base = snapshot.scenarios[0];
  if (!base) return [];
  // Funding first (what's needed, what's available, what's left), then holding costs and returns.
  const ORDER = ["cashRequired", "availableFunding", "fundingSurplus", "cashRemaining", "headroom", "newLvr", "debtService", "annualCashflow", "monthlyCashflow", "grossYield", "netYield"];
  const rank = (k: string) => {
    const i = ORDER.indexOf(k.slice(3));
    return i < 0 ? ORDER.length : i;
  };
  return Object.keys(snapshot.values)
    .filter((k) => k.startsWith("s1."))
    .sort((a, b) => rank(a) - rank(b))
    .map((k) => {
      const raw = snapshot.valueLabels[k] ?? k;
      const label = raw.startsWith(`${base.name}: `) ? raw.slice(base.name.length + 2) : raw;
      return { key: k, label: label.charAt(0).toUpperCase() + label.slice(1), value: snapshot.values[k] };
    });
}

export function reportTitle(snapshot: ReportSnapshot) {
  const purpose = snapshot.profile.flatMap((t) => t.items).find((i) => i.label === "Purchase purpose")?.value ?? "";
  if (/invest/i.test(purpose)) return "Investment property assessment";
  if (/home|occup|ppor|live/i.test(purpose)) return "Home purchase assessment";
  return "Buyer assessment";
}

export const ACTIVITY_VERB: Record<string, string> = {
  "report.create": "created this draft",
  "report.edit": "edited commentary",
  "report.submit": "submitted for review",
  "report.approve": "approved the report",
  "report.request_changes": "requested changes",
  "report.export": "exported a PDF",
  "report.download": "downloaded a PDF",
};
