"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, cx, Spinner, TextArea } from "@/components/ui";
import { api, newKey, waitForJob } from "@/lib/client/api";
import { dateTime } from "@/lib/format";
import { labelFor } from "@/lib/profile/fields";
import { useWs } from "../context";
import { needsDecision } from "./shared";

type Tone = "est" | "warn" | "warnStrong";
const MARK_CLS: Record<Tone, string> = {
  est: "bg-est-tint border-b border-est-line",
  warn: "bg-warn-tint border-b border-warn-line",
  warnStrong: "bg-warn-tint border-b-2 border-warn",
};

/** Split `text` into plain runs and highlighted evidence sentences (first occurrence, no overlaps). */
function highlight(text: string, spans: { needle: string; tone: Tone }[]): ReactNode[] {
  const hits: { start: number; end: number; tone: Tone }[] = [];
  for (const s of spans) {
    const needle = s.needle.trim();
    if (!needle) continue;
    const start = text.indexOf(needle);
    if (start < 0) continue;
    const end = start + needle.length;
    const clash = hits.find((h) => start < h.end && end > h.start);
    if (clash) {
      // Keep the strongest tone on overlapping evidence.
      if (s.tone !== "est" && clash.tone === "est") clash.tone = s.tone;
      continue;
    }
    hits.push({ start, end, tone: s.tone });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  hits.forEach((h, i) => {
    if (h.start > at) out.push(text.slice(at, h.start));
    out.push(
      <mark key={i} className={cx("text-inherit", MARK_CLS[h.tone])}>
        {text.slice(h.start, h.end)}
      </mark>,
    );
    at = h.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * "Meeting notes": the latest pasted notes with each suggested fact's source sentence highlighted,
 * plus a disclosure to paste new notes. `compact` shows only the paste disclosure (guided mode).
 */
export function NotesCard({ paste, compact }: { paste: PasteState; compact?: boolean }) {
  const { ws } = useWs();
  const notes = useMemo(() => [...ws.turns].reverse().find((t) => t.kind === "notes"), [ws.turns]);
  const canEdit = ws.permissions.canEdit;

  const view = useMemo(() => {
    if (!notes) return null;
    const fromNotes = ws.profile.proposed.filter((f) => f.sourceId === notes.id);
    const conflictFacts = Object.entries(ws.profile.conflicts).flatMap(([path, fs]) => fs.filter((f) => f.sourceId === notes.id || (f.evidenceText && notes.text.includes(f.evidenceText))).map((f) => ({ path, f })));
    const decision = fromNotes.filter((f) => needsDecision(ws, f));
    const suggested = fromNotes.length - decision.length;
    const confirmed = Object.values(ws.profile.confirmed).filter((c) => c.sourceType === "notes" && c.evidenceText && notes.text.includes(c.evidenceText)).length;
    const decisions = decision.length + new Set(conflictFacts.map((c) => c.path)).size;
    const spans = [
      ...conflictFacts.map((c) => ({ needle: c.f.evidenceText ?? "", tone: "warnStrong" as const })),
      ...fromNotes.map((f) => ({ needle: f.evidenceText ?? "", tone: (ws.profile.conflicts[f.fieldPath] ? "warnStrong" : needsDecision(ws, f) ? "warn" : "est") as Tone })),
    ];
    return { body: highlight(notes.text, spans), confirmed, suggested, decisions, total: confirmed + fromNotes.length + conflictFacts.length };
  }, [notes, ws]);

  if (compact) {
    if (!canEdit) return null;
    return (
      <section aria-label="Paste notes" className="rounded-lg border border-line bg-surface">
        <PasteNotes p={paste} />
      </section>
    );
  }

  return (
    <section aria-label="Meeting notes" className="flex flex-col rounded-lg border border-line bg-surface">
      {notes && view ? (
        <div className="flex flex-col gap-2.5 px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="flex-1 text-sm font-semibold text-ink">Meeting notes</h2>
            <span className="text-xs text-muted">
              Pasted · {dateTime(notes.createdAt)}
              {notes.extractionStatus === "pending" && " · analysing"}
              {notes.extractionStatus === "failed" && <span className="text-warn"> · analysis failed</span>}
            </span>
          </div>
          <p className="text-sm leading-[1.75] whitespace-pre-wrap text-ink-2">{view.body}</p>
          <p className="text-xs text-muted">
            {view.total} fact{view.total === 1 ? "" : "s"} found · <span className="text-ok">✓ {view.confirmed} confirmed</span> · <span className="text-est">◐ {view.suggested} suggested</span>
            {view.decisions > 0 && (
              <>
                {" "}
                · <span className="text-warn">⚠︎ {view.decisions} need{view.decisions === 1 ? "s" : ""} a decision</span>
              </>
            )}{" "}
            · Nothing is used in calculations until confirmed.
          </p>
        </div>
      ) : (
        <div className="px-4 pt-4 md:px-5">
          <h2 className="text-sm font-semibold text-ink">Meeting notes</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">No notes pasted yet.{canEdit ? " Paste notes, messages or a transcript and the facts found are suggested for you to confirm." : ""}</p>
        </div>
      )}
      {canEdit && (
        <div className={cx(notes && "border-t border-line-soft")}>
          <PasteNotes p={paste} label={notes ? "Paste more notes" : undefined} />
        </div>
      )}
    </section>
  );
}

export type PasteState = ReturnType<typeof usePasteNotes>;

/** Paste-notes state lives in the tab so an extraction result survives the switch to notes mode. */
export function usePasteNotes(defaultOpen: boolean) {
  const { ws, mutate } = useWs();
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const running = status === "queued" || status === "running";

  const extract = async () => {
    setError(null);
    setResult(null);
    const res = await mutate("Submit notes", () => api<{ jobId: string }>(`/api/assessments/${ws.assessment.id}/extract`, { body: { text, idempotencyKey: key.current, expectedRevision: ws.assessment.currentRevision } }));
    if (!res?.jobId) return;
    setStatus("queued");
    const job = await waitForJob(res.jobId, setStatus);
    setStatus(job.status);
    if (job.status === "succeeded") {
      setResult(job.result);
      setText("");
      key.current = newKey();
    } else setError(job.error?.message ?? "Extraction failed. Your notes are saved; enter facts directly in the profile.");
    await mutate("Refresh", async () => null);
  };
  return { open, setOpen, text, setText, running, result, error, extract };
}

function PasteNotes({ p, label }: { p: PasteState; label?: string }) {
  const { ws } = useWs();
  const { open, setOpen, text, setText, running, result, error, extract } = p;
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink-secondary hover:text-ink md:px-5">
        <span aria-hidden="true" className="w-3 text-[10px] text-muted">
          {open ? "▾" : "▸"}
        </span>
        {label ?? "Paste notes, messages or a transcript"}
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4 md:px-5">
          <p className="text-xs text-muted">
            Facts are extracted as suggestions with their source text.{" "}
            {ws.ai.enabled ? `AI extraction is on (${ws.ai.model}); the rule-based extractor is used if AI fails.` : "AI is not configured: the rule-based extractor is used. Review every suggestion."} Pasted text is treated as data, never as
            instructions.
          </p>
          <label htmlFor="notes" className="sr-only">
            Notes
          </label>
          <TextArea id="notes" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Sam earns $2,400 per week after tax. Living expenses about $4,000 per month. Looking for an investment house in Ipswich…" className="text-base md:text-sm" />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!text.trim() || running} onClick={extract}>
              Extract facts
            </Button>
            {running && <Spinner label="Extracting facts…" />}
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          {result && (
            <Alert tone={result.aiError ? "warn" : "ok"} title={`${result.proposed as number} fact(s) suggested`}>
              {result.engine === "ai" ? "AI extraction." : "Rule-based extraction."}{" "}
              {result.aiError ? `AI was unavailable (${String(result.aiError).replaceAll("_", " ")}), so the rule-based extractor was used — check carefully. ` : ""}
              {(result.clarifications as number) > 0 && `${result.clarifications as number} clarification question(s) added to the conversation. `}
              {((result.conflicts as string[]) ?? []).length > 0 && `Conflicting values kept for: ${(result.conflicts as string[]).map(labelFor).join(", ")}. `}
              {((result.rejected as unknown[]) ?? []).length > 0 && `${(result.rejected as unknown[]).length} item(s) failed validation and were not suggested. `}
              {(result.duplicatesSkipped as number) > 0 && `${result.duplicatesSkipped as number} already-confirmed value(s) skipped.`}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
