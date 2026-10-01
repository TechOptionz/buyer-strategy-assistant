"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cx, Mark, Source } from "@/components/ui";
import { labelFor } from "@/lib/profile/fields";
import { useWs } from "../context";
import { markFor, sourceFor } from "../derive";
import { FieldEditor, type Entry } from "../FieldEditor";
import { consequenceNote, displayFor, rowId } from "./util";

export interface ProfileUi {
  /** Open the Value details panel for a field. */
  open: (path: string) => void;
  selected: string | null;
  /** Field currently in inline edit. */
  editing: string | null;
  setEditing: (path: string | null) => void;
  /** Save one field; resolves true on success. */
  saveField: (path: string, e: Entry) => Promise<boolean>;
}

export const ProfileUiCtx = createContext<ProfileUi | null>(null);
export function useProfileUi() {
  const c = useContext(ProfileUiCtx);
  if (!c) throw new Error("useProfileUi outside ProfileTab");
  return c;
}

/** Link-style header action (13px accent text). */
export function LinkButton({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx("text-[13px] text-accent hover:text-accent-hover hover:underline", className)}>
      {children}
    </button>
  );
}

/** Panel with 16/600 h2 header and optional link-style actions. */
export function Section({ title, actions, children, note, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-lg border border-line bg-surface", className)} aria-label={typeof title === "string" ? title : undefined}>
      <header className="flex items-baseline gap-3 border-b border-line px-4 py-3 md:px-5 md:py-3.5">
        <h2 className="flex-1 text-[15px] font-semibold text-ink md:text-base">{title}</h2>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </header>
      {note && <p className="border-b border-line-soft bg-subtle px-4 py-2 text-xs text-muted md:px-5">{note}</p>}
      {children}
    </section>
  );
}

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 md:grid-cols-[minmax(140px,220px)_minmax(120px,1fr)_150px_minmax(0,260px)] md:gap-x-4 md:gap-y-0";

/**
 * TracedValue row: label | value (right) | mark | source. Click opens Value details. In inline edit the
 * row becomes accent-wash with an inset accent bar and holds the typed editor.
 */
export function FieldRow({ path, label, sectionEdit, sourceNote }: { path: string; label?: string; sectionEdit?: boolean; sourceNote?: string }) {
  const { ws, changed } = useWs();
  const ui = useProfileUi();
  const name = label ?? labelFor(path);
  const canEdit = ws.permissions.canEdit;

  if (ui.editing === path && canEdit) {
    const c = ws.profile.confirmed[path];
    return (
      <div id={rowId(path)} className={cx(GRID, "items-start border-b border-line-soft bg-accent-wash px-4 py-2.5 shadow-[inset_2px_0_0_var(--color-accent)] md:px-5")}>
        <span className="col-span-2 pt-2 text-sm text-ink-secondary md:col-span-1 md:text-[13px]">{name}</span>
        <div className="col-span-2 md:col-span-3">
          <FieldEditor
            path={path}
            hideLabel
            initial={c?.state === "value" ? c.value : undefined}
            note={consequenceNote(ws, path)}
            onCancel={() => ui.setEditing(null)}
            onSave={async (e) => {
              if (await ui.saveField(path, e)) ui.setEditing(null);
            }}
          />
        </div>
      </div>
    );
  }

  const v = displayFor(ws, path);
  const m = markFor(ws, path);
  const source = sourceFor(ws, path) + (sourceNote ? ` · ${sourceNote}` : "");
  const selected = ui.selected === path;
  return (
    <div
      id={rowId(path)}
      className={cx(
        GRID,
        "relative items-center border-b border-line-soft px-4 py-2.5 last:border-b-0 hover:bg-subtle md:min-h-11 md:px-5 md:py-2",
        selected && "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)] hover:bg-accent-wash",
      )}
    >
      <button
        type="button"
        onClick={() => ui.open(path)}
        aria-label={`${name}: ${v.text}${v.unit}. Open value details`}
        className="text-left text-sm text-ink-secondary after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-accent md:text-[13px]"
      >
        {name}
      </button>
      <span className={cx("num text-right text-[15px] font-medium md:text-sm", v.muted ? "text-muted" : "text-ink", changed.has(path) && "just-changed rounded px-1")}>
        {v.text}
        {v.unit && <span className="text-[13px] font-normal text-ink-secondary">{v.unit}</span>}
      </span>
      <span className="order-4 text-right md:order-3 md:text-left">
        <Mark kind={m.kind} label={m.label} />
      </span>
      <span className="order-3 flex min-w-0 items-center gap-2 md:order-4">
        <Source className="min-w-0 flex-1 truncate" >
          <span title={source}>{source}</span>
        </Source>
        {sectionEdit && canEdit && (
          <button
            type="button"
            onClick={() => ui.setEditing(path)}
            className="relative z-10 shrink-0 text-[13px] text-accent hover:text-accent-hover hover:underline"
          >
            {ws.profile.confirmed[path] || ws.profile.conflicts[path] ? "Edit" : "Add"}
            <span className="sr-only"> {name}</span>
          </button>
        )}
      </span>
    </div>
  );
}
