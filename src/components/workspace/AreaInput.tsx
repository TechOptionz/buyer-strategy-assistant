"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";

/** Paths whose values are lists of areas (suburbs or localities). */
export const AREA_PATHS = new Set(["preferences.areas", "preferences.excludedAreas"]);

const split = (v: string) =>
  v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Searchable location control (CON01): areas become removable chips; typing searches areas already
 * used in the organisation, and any new name can still be added. The value stays a comma-separated
 * string, so callers parse it exactly as before.
 */
export function AreaInput({
  id,
  value,
  onChange,
  suggestions,
  onSubmit,
  invalid,
  large,
  placeholder = "Type a suburb, e.g. Ipswich",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  /** Enter on an empty search box (e.g. confirm the interview answer). */
  onSubmit?: () => void;
  invalid?: boolean;
  large?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const chips = split(value);
  const has = (name: string) => chips.some((c) => c.toLowerCase() === name.toLowerCase());

  const q = draft.trim().toLowerCase();
  const pool = suggestions.filter((s) => !has(s));
  // Prefix matches first, then other substring matches.
  const matches = (q ? pool.filter((s) => s.toLowerCase().includes(q)).sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))) : pool).slice(0, 8);

  const add = (name: string) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || has(clean)) return setDraft("");
    onChange([...chips, clean].join(", "));
    setDraft("");
    setActive(0);
  };
  const remove = (name: string) => onChange(chips.filter((c) => c !== name).join(", "));

  const typedIsNew = draft.trim() && !matches.some((m) => m.toLowerCase() === draft.trim().toLowerCase()) && !has(draft.trim());
  const options = [...matches.map((m) => ({ label: m, value: m, isNew: false })), ...(typedIsNew ? [{ label: `Add “${draft.trim()}”`, value: draft.trim(), isNew: true }] : [])];

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (draft.trim()) add(open && options[active] ? options[active].value : draft);
      else onSubmit?.();
    } else if (e.key === "," || e.key === ";") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && !draft && chips.length) {
      remove(chips[chips.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        onClick={() => input.current?.focus()}
        className={cx(
          "flex flex-wrap items-center gap-1.5 rounded border bg-surface px-2 py-1 focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent",
          large ? "min-h-11 md:min-h-9" : "min-h-9",
          invalid ? "border-bad" : "border-line-strong",
        )}
      >
        {chips.map((c) => (
          <span key={c} className="inline-flex h-6 items-center gap-1 rounded bg-accent-tint pr-1 pl-2 text-[13px] font-medium text-accent">
            {c}
            <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c}`} className="rounded px-0.5 text-sm leading-none hover:bg-accent-line">
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          value={draft}
          autoComplete="off"
          placeholder={chips.length ? "Add another area" : placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={cx("min-w-[10ch] flex-1 bg-transparent py-1 outline-none placeholder:text-faint", large ? "text-base md:text-sm" : "text-sm")}
        />
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-overlay)]">
          {options.map((o, i) => (
            <li
              key={`${o.isNew}-${o.value}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(o.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx("cursor-pointer px-3 py-1.5 text-[13px]", i === active ? "bg-accent-wash text-ink" : "text-ink-2", o.isNew && "text-accent")}
            >
              {o.label}
              {!o.isNew && <span className="ml-2 text-xs text-muted">used before</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">Press Enter or comma to add. Suggestions are areas already used in your organisation.</p>
    </div>
  );
}
