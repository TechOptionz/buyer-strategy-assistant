"use client";

import { useState } from "react";
import { Button, cx, Mark, SidePanel } from "@/components/ui";
import { date, SOURCE_LABEL } from "@/lib/format";
import { fieldDef, labelFor, type Topic } from "@/lib/profile/fields";
import { useWs } from "../context";
import { markFor, STATE_LABEL } from "../derive";
import { FieldEditor } from "../FieldEditor";
import { useProfileUi } from "./Row";
import { consequenceNote, displayFor, fmt, rowId, whoWhen } from "./util";

/** Typical use of each topic — generic and truthful; specific gaps come from readiness. */
const TOPIC_USE: Record<Topic, string> = {
  case: "Case record and report audience",
  goals: "Buyer summary · report objectives",
  household: "Household affordability view",
  properties: "Equity and existing loans · funding ceiling",
  funds: "Deposit scenario · funding ceiling",
  super: "Shown for context only",
  finance: "Funding ceiling · scenario loan terms",
  preferences: "Suburb comparison · area fit",
  scenario: "Scenario Lab · deposit and rental cashflow",
};

const SHOWN = 3;

/** Value details SidePanel (420px; full-screen sheet on mobile). Render with key={path}. */
export function ValueDetails({ path, onClose }: { path: string; onClose: () => void }) {
  const { ws, goTab } = useWs();
  const ui = useProfileUi();
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(false);
  const def = fieldDef(path);
  const c = ws.profile.confirmed[path];
  const conflict = ws.profile.conflicts[path];
  const proposed = ws.profile.proposed.filter((f) => f.fieldPath === path);
  const v = displayFor(ws, path);
  const m = markFor(ws, path);
  const canEdit = ws.permissions.canEdit;

  // History: current value first (ok dot), then superseded/rejected facts (faint dot, struck value).
  type Item = { id: string; what: string; who: string; value: string; current: boolean };
  const items: Item[] = [];
  if (c) items.push({ id: c.factId, what: "Current value", who: whoWhen(ws, c.sourceType, c.confirmedById, c.confirmedAt), value: c.state === "value" ? `${fmt(path, c.value)}${v.unit}` : (STATE_LABEL[c.state] ?? "—"), current: true });
  for (const h of ws.history[path] ?? []) {
    items.push({
      id: h.id,
      what: `${h.status === "rejected" ? "Rejected" : "Previous value"} · ${SOURCE_LABEL[h.sourceType] ?? h.sourceType}`,
      who: whoWhen(ws, null, h.confirmedById, h.confirmedAt ?? h.createdAt) || date(h.createdAt),
      value: h.valueState === "value" ? fmt(path, h.value) : (STATE_LABEL[h.valueState] ?? "—"),
      current: false,
    });
  }

  // Used in: outputs that list this field as missing, scenarios it made out of date, then the topic's typical use.
  const neededBy = ws.readiness.filter((r) => r.missing.some((x) => x.path === path)).map((r) => r.label);
  const staleIn = ws.scenarios.filter((s) => s.staleBecause.includes(path)).map((s) => s.name);

  const startEdit = () => {
    // Prefer inline edit in the row (design); fall back to editing inside the panel.
    if (typeof document !== "undefined" && document.getElementById(rowId(path))) {
      onClose();
      ui.setEditing(path);
      requestAnimationFrame(() => document.getElementById(rowId(path))?.scrollIntoView({ block: "center", behavior: "smooth" }));
    } else setEditing(true);
  };

  const footer =
    (canEdit && !editing) || items.length > SHOWN ? (
      <>
        {canEdit && !editing && (
          <Button variant="secondary" className="flex-1 max-md:h-12 max-md:text-base md:flex-none" onClick={startEdit}>
            {c || conflict ? "Edit value" : "Add value"}
          </Button>
        )}
        {items.length > SHOWN && (
          <Button variant="tertiary" className="max-md:hidden" onClick={() => setAll((a) => !a)}>
            {all ? "Show recent history" : `Open full history (${items.length})`}
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <SidePanel open onClose={onClose} label="Value details" footer={footer}>
      <div className="flex flex-col gap-1.5 border-b border-line px-4 pt-5 pb-5 md:px-6 md:pt-2">
        <span className="text-sm text-ink-secondary">{labelFor(path)}</span>
        <span className={cx("num text-[30px] leading-tight font-semibold break-words", v.muted ? "text-muted" : "text-ink")}>
          {v.text}
          {v.unit && <span className="text-sm font-normal text-ink-secondary">{v.unit}</span>}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Mark kind={m.kind} label={m.label} />
          {c && <span className="text-xs text-muted">{whoWhen(ws, c.sourceType, c.confirmedById, c.confirmedAt)}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4 md:px-6">
        {editing && canEdit && (
          <div className="rounded border border-accent-line bg-accent-wash p-3">
            <FieldEditor
              path={path}
              initial={c?.state === "value" ? c.value : undefined}
              note={consequenceNote(ws, path)}
              onCancel={() => setEditing(false)}
              onSave={async (e) => {
                if (await ui.saveField(path, e)) setEditing(false);
              }}
            />
          </div>
        )}

        {conflict && (
          <div className="flex flex-col gap-2 rounded border border-warn-line bg-warn-tint px-3.5 py-3">
            <span className="text-[13px] font-semibold text-warn">⚠︎ {conflict.length} confirmed values disagree</span>
            {conflict.map((f) => (
              <div key={f.id} className="flex items-baseline gap-3 text-[13px]">
                <span className="flex-1 text-ink-2">{whoWhen(ws, f.sourceType, f.confirmedById, f.confirmedAt ?? f.createdAt)}</span>
                <span className="num font-medium text-ink">{f.valueState === "value" ? fmt(path, f.value) : STATE_LABEL[f.valueState]}</span>
              </div>
            ))}
            <Button variant="tertiary" size="sm" className="self-start !px-0" onClick={() => goTab("interview")}>
              Resolve in the Interview tab →
            </Button>
          </div>
        )}

        {!c && !conflict && proposed.length > 0 && (
          <div className="flex flex-col gap-2 rounded border border-est-line bg-est-wash px-3.5 py-3">
            <span className="text-[13px] font-semibold text-est">◐ Suggested, not confirmed</span>
            {proposed.map((f) => (
              <div key={f.id} className="flex items-baseline gap-3 text-[13px]">
                <span className="flex-1 text-ink-2">
                  {SOURCE_LABEL[f.sourceType] ?? f.sourceType} · {f.proposedBy === "ai" ? "AI suggested" : "extracted"} · {date(f.createdAt)}
                </span>
                <span className="num font-medium text-ink">{f.valueState === "value" ? fmt(path, f.value) : STATE_LABEL[f.valueState]}</span>
              </div>
            ))}
            <Button variant="tertiary" size="sm" className="self-start !px-0" onClick={() => goTab("interview")}>
              Review in the Interview tab →
            </Button>
          </div>
        )}

        {(c?.evidenceText || proposed[0]?.evidenceText) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Source excerpt</span>
            <blockquote className="rounded border border-line bg-subtle px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
              “<mark className="border-b border-est-line bg-est-wash text-inherit">{c?.evidenceText ?? proposed[0]?.evidenceText}</mark>”
            </blockquote>
            <span className="text-xs text-muted">
              {c ? [SOURCE_LABEL[c.sourceType] ?? c.sourceType, c.confirmedAt ? date(c.confirmedAt) : null].filter(Boolean).join(" · ") : `${SOURCE_LABEL[proposed[0]!.sourceType] ?? proposed[0]!.sourceType} · ${date(proposed[0]!.createdAt)}`}
            </span>
          </div>
        )}

        <div id={`history-${path}`} className="flex flex-col">
          <span className="mb-2 text-xs font-medium text-muted">History</span>
          {!items.length && <span className="text-[13px] text-muted">No recorded values yet.</span>}
          {items.map((h, n) => (
            <div key={h.id} className={cx("grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-line-soft py-2.5 md:grid-cols-[12px_1fr_auto]", !all && n >= SHOWN && "md:hidden")}>
              <span aria-hidden="true" className={cx("mt-1.5 hidden h-2 w-2 rounded-full md:block", h.current ? "bg-ok" : "bg-faint")} />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink md:text-[13px]">{h.what}</span>
                <span className="text-xs text-muted">{h.who}</span>
              </div>
              <span className={cx("num text-right text-sm font-medium md:text-[13px]", h.current ? "text-ink" : "text-muted line-through")}>
                {!h.current && <span className="sr-only">Replaced value: </span>}
                {h.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Used in</span>
          {neededBy.length > 0 && <span className="text-[13px] text-ink">Needed for: {neededBy.join(" · ")}</span>}
          {staleIn.length > 0 && <span className="text-[13px] text-warn">↻ Changed since: {staleIn.join(", ")} (out of date)</span>}
          {def && <span className={cx("text-[13px]", neededBy.length || staleIn.length ? "text-muted" : "text-ink")}>{TOPIC_USE[def.topic]}</span>}
          {def?.topic === "super" && <span className="text-xs text-muted">Never counted as purchase funding. A balance alone does not establish availability.</span>}
        </div>
      </div>
    </SidePanel>
  );
}
