"use client";

import { useContext, useId, useState } from "react";
import { AffixInput, Button, Field, MoneyInput, Select, TextArea, TextInput } from "@/components/ui";
import { fromCents, toCents } from "@/lib/client/api";
import { fieldDef, labelFor } from "@/lib/profile/fields";
import { AREA_PATHS, AreaInput } from "./AreaInput";
import { WsContext } from "./context";

export type Entry = { valueState: "value" | "unknown" | "not_applicable" | "declined"; value?: unknown };

function initialText(type: string, v: unknown) {
  if (v == null) return "";
  if (type === "money") return fromCents(v as number);
  if (type === "list") return (v as string[]).join(", ");
  return String(v);
}

/**
 * Typed editor for one profile field. Distinguishes an explicit value (including zero) from
 * Unknown, Not applicable and Prefer not to say (INT03). Label above, units as affixes.
 */
export function FieldEditor({
  path,
  initial,
  onSave,
  onCancel,
  saveLabel = "Save",
  allowStates = true,
  hideLabel = false,
  note,
}: {
  path: string;
  initial?: unknown;
  onSave: (e: Entry) => Promise<unknown> | void;
  onCancel?: () => void;
  saveLabel?: string;
  allowStates?: boolean;
  hideLabel?: boolean;
  /** Consequence shown beside the actions, e.g. "Saving marks 2 scenarios Out of date". */
  note?: string;
}) {
  const def = fieldDef(path);
  const id = useId();
  // Optional: the editor is also usable outside a case workspace (no area suggestions there).
  const ws = useContext(WsContext);
  const [text, setText] = useState(initialText(def?.type ?? "text", initial));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!def) return <p className="text-[13px] text-bad">Unknown field {path}</p>;

  const parse = (): unknown => {
    switch (def.type) {
      case "money": {
        const c = toCents(text);
        if (c == null) throw new Error("Enter an amount (use 0 for an explicit zero)");
        if (Number.isNaN(c)) throw new Error("Enter an amount like 750000, 750k or 1.2m");
        return c;
      }
      case "number":
      case "percent": {
        if (text.trim() === "") throw new Error("Enter a number");
        const n = Number(text);
        if (!Number.isFinite(n)) throw new Error("Enter a number");
        return n;
      }
      case "boolean":
        if (text !== "true" && text !== "false") throw new Error("Choose yes or no");
        return text === "true";
      case "list": {
        const items = text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        if (!items.length) throw new Error("Enter at least one item");
        return items;
      }
      case "enum":
        if (!text) throw new Error("Choose an option");
        return text;
      default:
        if (!text.trim()) throw new Error("Enter a value");
        return text.trim();
    }
  };

  const submit = async (entry: Entry) => {
    setBusy(true);
    try {
      await onSave(entry);
    } finally {
      setBusy(false);
    }
  };

  const describedBy = error ? `${id}-error` : def.help ? `${id}-hint` : undefined;
  let control;
  switch (def.type) {
    case "money":
      control = <MoneyInput id={id} value={text} onChange={(e) => setText(e.target.value)} invalid={!!error} aria-describedby={describedBy} placeholder="e.g. 750000 or 750k" autoFocus />;
      break;
    case "percent":
      control = <AffixInput id={id} type="number" inputMode="decimal" step="any" min={0} max={100} value={text} onChange={(e) => setText(e.target.value)} invalid={!!error} aria-describedby={describedBy} suffix="%" autoFocus />;
      break;
    case "enum":
      control = (
        <Select id={id} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} autoFocus>
          <option value="">Choose…</option>
          {def.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    case "boolean":
      control = (
        <Select id={id} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} autoFocus>
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
      break;
    case "text":
      control = <TextArea id={id} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} autoFocus />;
      break;
    case "date":
      control = <TextInput id={id} type="date" value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} autoFocus />;
      break;
    case "list":
      control = AREA_PATHS.has(path) ? (
        <AreaInput id={id} value={text} onChange={setText} suggestions={ws?.ws.knownAreas ?? []} invalid={!!error} />
      ) : (
        <TextInput id={id} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} placeholder="Separate items with commas" autoFocus />
      );
      break;
    default:
      control = <AffixInput id={id} type="number" inputMode="decimal" step="any" min={0} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={describedBy} invalid={!!error} autoFocus />;
  }

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const value = parse();
          setError(undefined);
          await submit({ valueState: "value", value });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Invalid value");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <Field label={hideLabel ? <span className="sr-only">{labelFor(path)}</span> : labelFor(path)} htmlFor={id} error={error} hint={def.help}>
        {control}
      </Field>
      <div className="flex flex-wrap items-center gap-1">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : saveLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="tertiary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {allowStates && (
          <>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => submit({ valueState: "unknown" })}>
              Unknown
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => submit({ valueState: "not_applicable" })}>
              Not applicable
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => submit({ valueState: "declined" })}>
              Prefer not to say
            </Button>
          </>
        )}
        {note && <span className="ml-auto text-xs text-warn">{note}</span>}
      </div>
    </form>
  );
}
