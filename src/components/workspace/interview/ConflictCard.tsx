"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { date, SOURCE_LABEL } from "@/lib/format";
import { formatValue, labelFor } from "@/lib/profile/fields";
import { useWs } from "../context";
import { STATE_LABEL } from "../derive";
import { FieldEditor } from "../FieldEditor";
import { blockedOutputs, outputText } from "./shared";

/** INT04/AT02: both values stay until a person chooses or supplies the correct one. */
export function ConflictCard({ path, label }: { path: string; label: string }) {
  const { ws, mutate } = useWs();
  const facts = ws.profile.conflicts[path] ?? [];
  const show = (f: (typeof facts)[number]) => (f.valueState === "value" ? formatValue(path, f.value) : (STATE_LABEL[f.valueState] ?? f.valueState));
  const latest = facts.reduce<(typeof facts)[number] | undefined>((a, f) => (!a || +new Date(f.createdAt) > +new Date(a.createdAt) ? f : a), undefined);
  const [choice, setChoice] = useState<string | "manual" | null>(latest?.id ?? null);
  const [busy, setBusy] = useState(false);
  const blocks = blockedOutputs(ws, path);
  const chosen = facts.find((f) => f.id === choice);

  const resolve = async (body: Record<string, unknown>) => {
    setBusy(true);
    await mutate("Resolve conflict", () => api(`/api/assessments/${ws.assessment.id}/profile`, { method: "PATCH", body: { action: "resolve", expectedRevision: ws.assessment.currentRevision, path, ...body } }));
    setBusy(false);
  };

  const sourceLine = (f: (typeof facts)[number]) =>
    [
      SOURCE_LABEL[f.sourceType] ?? f.sourceType.replaceAll("_", " "),
      f.confirmedById && ws.people[f.confirmedById] ? ws.people[f.confirmedById] : null,
      date(f.confirmedAt ?? f.createdAt),
      facts.length > 1 && f.id === latest?.id ? "later source" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section aria-label={`Conflict: ${label}`} className="-mx-4 overflow-hidden border-y border-warn-line bg-surface md:mx-0 md:rounded-lg md:border">
      <header className="flex flex-col gap-1 border-b border-warn-line bg-warn-tint px-4 py-3.5 md:px-5">
        <span className="text-xs font-medium text-warn">
          <span aria-hidden="true">⚠︎ </span>Conflict · {label || labelFor(path)}
          {blocks.length > 0 && ` · blocks ${blocks.map(outputText).join(", ")}`}
        </span>
        <h2 className="text-xl leading-[1.35] font-semibold text-ink md:text-base">
          {facts.length > 1 ? `${facts.length > 2 ? `${facts.length} values` : "Two values"} disagree: ${facts.map(show).join(" vs ")}. Which is current?` : "Which value is current?"}
        </h2>
      </header>
      <div className="flex flex-col gap-2 px-4 py-3 md:px-5">
        <p className="text-xs text-muted">This field is excluded from calculations until you choose.</p>
        <div role="radiogroup" aria-label="Which value is current" className="flex flex-col gap-2">
          {facts.map((f) => {
            const on = choice === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChoice(f.id)}
                className={cx("flex items-start gap-3 rounded border px-3.5 py-3 text-left", on ? "border-accent bg-accent-wash" : "border-line-strong bg-surface hover:bg-hover")}
              >
                <Radio on={on} className="mt-[3px]" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="num text-lg font-semibold text-ink md:text-[15px]">{show(f)}</span>
                  {f.evidenceText && <span className="text-sm text-ink-secondary italic md:text-[13px]">“{f.evidenceText}”</span>}
                  <span className="text-xs text-muted">{sourceLine(f)}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={choice === "manual"}
            onClick={() => setChoice("manual")}
            className={cx("flex items-center gap-3 rounded border border-dashed px-3.5 py-2.5 text-left text-[15px] md:text-[13px]", choice === "manual" ? "border-accent bg-accent-wash text-ink" : "border-line-strong text-ink-secondary hover:bg-hover")}
          >
            <Radio on={choice === "manual"} />
            Enter a different value
          </button>
        </div>
        {choice === "manual" ? (
          <div className="rounded border border-line bg-subtle p-3">
            <FieldEditor path={path} onSave={(e) => resolve({ valueState: e.valueState, value: e.value })} onCancel={() => setChoice(latest?.id ?? null)} saveLabel={`Set ${labelFor(path).toLowerCase()}`} />
          </div>
        ) : (
          <div className="flex flex-col gap-2 pt-1 md:flex-row md:items-center">
            <Button variant="primary" disabled={!chosen || busy} onClick={() => chosen && resolve({ keepFactId: chosen.id })} className="h-12 text-base md:h-9 md:text-sm">
              {busy ? "Saving…" : chosen ? `Use ${show(chosen)}` : "Choose a value"}
            </Button>
            <span className="hidden flex-1 md:block" />
            <span className="text-xs text-muted">Both values stay in history</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Radio({ on, className }: { on: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx("h-4 w-4 shrink-0 rounded-full bg-surface", on ? "border-[5px] border-accent" : "border border-faint", className)} />;
}
