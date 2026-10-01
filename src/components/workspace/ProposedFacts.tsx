"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { SOURCE_LABEL } from "@/lib/format";
import { formatValue } from "@/lib/profile/fields";
import { useWs } from "./context";
import { STATE_LABEL, valueFor } from "./derive";
import { FieldEditor } from "./FieldEditor";
import type { Proposed } from "./interview/shared";

const PAGE = 6;

/**
 * INT02/INT05: "Suggested facts" with their supporting text. Nothing is applied until a person
 * confirms; several reviewed facts can be confirmed together (one value per field).
 */
export function ProposedFacts() {
  const { ws, mutate } = useWs();
  const proposed = ws.profile.proposed;
  const canEdit = ws.permissions.canEdit;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const headerBox = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Proposed[]>();
    for (const f of proposed) m.set(f.fieldPath, [...(m.get(f.fieldPath) ?? []), f]);
    return [...m.entries()];
  }, [proposed]);

  // Drop selections for facts that are no longer proposed (confirmed/rejected elsewhere).
  const live = useMemo(() => new Set(proposed.map((f) => f.id)), [proposed]);
  const sel = useMemo(() => new Set([...selected].filter((id) => live.has(id))), [selected, live]);
  const maxSelectable = groups.length; // one value per field
  const allSelected = sel.size > 0 && sel.size === maxSelectable;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = sel.size > 0 && !allSelected;
  }, [sel.size, allSelected]);

  if (!proposed.length) return null;
  const id = ws.assessment.id;

  const confirm = (items: { factId: string; value?: unknown }[]) =>
    mutate("Confirm facts", () => api(`/api/assessments/${id}/profile`, { method: "PATCH", body: { action: "confirm", expectedRevision: ws.assessment.currentRevision, items } })).then(() => setSelected(new Set()));
  const reject = (factIds: string[]) =>
    mutate("Reject facts", () => api(`/api/assessments/${id}/profile`, { method: "PATCH", body: { action: "reject", factIds } })).then(() => setSelected(new Set()));

  // Selecting two different values for the same field would create a conflict; allow only one per field.
  const toggle = (factId: string, path: string) =>
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => live.has(x)));
      if (next.has(factId)) next.delete(factId);
      else {
        for (const f of proposed) if (f.fieldPath === path) next.delete(f.id);
        next.add(factId);
      }
      return next;
    });
  // Header checkbox: select the first value of every field (fields with several values keep one).
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(groups.map(([, facts]) => (facts.find((f) => sel.has(f.id)) ?? facts[0]).id)));

  // Paginate by field group so a field's alternative values stay together.
  let shown = 0;
  const visible: typeof groups = [];
  for (const g of groups) {
    if (!showAll && shown >= PAGE) break;
    visible.push(g);
    shown += g[1].length;
  }
  const hidden = proposed.length - shown;

  return (
    <section id="suggested-facts" aria-label="Suggested facts" className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-subtle px-4 py-3 md:px-5">
        {canEdit && (
          <input
            ref={headerBox}
            type="checkbox"
            aria-label={allSelected ? "Clear selection" : "Select one value for every field"}
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 shrink-0 accent-accent"
          />
        )}
        <h2 className="flex-1 text-[13px] font-medium text-ink">
          Suggested facts · {canEdit ? `${sel.size} of ${proposed.length} selected` : proposed.length}
        </h2>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" disabled={!sel.size} onClick={() => reject([...sel])}>
              Reject selected
            </Button>
            <Button size="sm" disabled={!sel.size} onClick={() => confirm([...sel].map((factId) => ({ factId })))}>
              Confirm {sel.size || ""} selected
            </Button>
          </div>
        )}
      </header>
      <ul>
        {visible.map(([path, facts]) => (
          <li key={path} className="border-b border-line-soft">
            {facts.length > 1 && (
              <p className="flex gap-1.5 bg-warn-wash px-4 pt-3 pb-1 text-xs font-medium text-warn md:px-5">
                <span aria-hidden="true">⚠︎</span>
                The source gives {facts.length} different values for {facts[0].label.toLowerCase()}. Select the one that is current.
              </p>
            )}
            <ul>
              {facts.map((f) => (
                <FactRow
                  key={f.id}
                  f={f}
                  multi={facts.length > 1}
                  canEdit={canEdit}
                  checked={sel.has(f.id)}
                  onToggle={() => toggle(f.id, f.fieldPath)}
                  onConfirm={() => confirm([{ factId: f.id }])}
                  onReject={() => reject([f.id])}
                  editing={editing === f.id}
                  onEdit={() => setEditing(editing === f.id ? null : f.id)}
                  onEditDone={async (value) => {
                    await confirm([{ factId: f.id, value }]);
                    setEditing(null);
                  }}
                  onEditCancel={() => setEditing(null)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="px-4 py-2.5 text-xs text-ink-secondary md:px-5">
        {hidden > 0 ? (
          <button type="button" className="text-accent hover:underline" onClick={() => setShowAll(true)}>
            Show {hidden} more
          </button>
        ) : showAll && proposed.length > PAGE ? (
          <button type="button" className="text-accent hover:underline" onClick={() => setShowAll(false)}>
            Show fewer
          </button>
        ) : null}
        {(hidden > 0 || (showAll && proposed.length > PAGE)) && " · "}
        Check each against its source text. Financial values are never confirmed automatically.
      </p>
    </section>
  );
}

function FactRow({
  f,
  multi,
  canEdit,
  checked,
  onToggle,
  onConfirm,
  onReject,
  editing,
  onEdit,
  onEditDone,
  onEditCancel,
}: {
  f: Proposed;
  multi: boolean;
  canEdit: boolean;
  checked: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReject: () => void;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (value: unknown) => Promise<void>;
  onEditCancel: () => void;
}) {
  const { ws } = useWs();
  const value = f.valueState === "value" ? formatValue(f.fieldPath, f.value) : (STATE_LABEL[f.valueState] ?? f.valueState);
  const note = [
    SOURCE_LABEL[f.sourceType] ?? f.sourceType,
    f.proposedBy === "ai" ? "AI suggested" : "Rule-based extraction",
    f.confidence ? `${f.confidence} extraction certainty` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const boxId = `fact-${f.id}`;
  return (
    <li
      className={cx(
        "grid gap-x-3 gap-y-1 px-4 py-3 md:px-5",
        canEdit ? "grid-cols-[16px_minmax(0,1fr)] md:grid-cols-[16px_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)]",
        multi ? "bg-warn-wash" : "hover:bg-est-wash",
      )}
    >
      {canEdit && <input id={boxId} type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 h-4 w-4 accent-accent" aria-label={`Select ${f.label}: ${value}`} />}
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-[13px] text-ink-secondary">{f.label}</span>
          <span className="num text-sm font-semibold text-ink">{value}</span>
          <span className="text-xs font-medium text-est">
            <span aria-hidden="true">◐ </span>Suggested
          </span>
        </div>
        {f.evidenceText && (
          <blockquote className="text-xs text-ink-secondary italic">
            <span className="sr-only">Source text: </span>“{f.evidenceText}”
          </blockquote>
        )}
        <span className="text-[11px] text-muted">{note}</span>
        {f.conflictsWithConfirmed && (
          <span className="text-[11px] font-medium text-warn">
            <span aria-hidden="true">⚠︎ </span>Differs from the confirmed value ({valueFor(ws, f.fieldPath).text}). Confirming it creates a conflict to resolve.
          </span>
        )}
      </div>
      {canEdit && (
        <div className="col-start-2 flex gap-1 md:col-start-3 md:row-start-1">
          <Button size="xs" onClick={onConfirm}>
            Confirm
          </Button>
          <Button size="xs" variant="tertiary" onClick={onEdit} aria-expanded={editing}>
            Edit
          </Button>
          <Button size="xs" variant="ghost" onClick={onReject}>
            Reject
          </Button>
        </div>
      )}
      {editing && (
        <div className="col-span-full mt-2 rounded border border-line bg-subtle p-3">
          <FieldEditor path={f.fieldPath} initial={f.value} allowStates={false} saveLabel="Confirm edited value" onCancel={onEditCancel} onSave={(e) => onEditDone(e.value)} />
        </div>
      )}
    </li>
  );
}
