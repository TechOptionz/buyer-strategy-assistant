"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cx, Field, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { dateTime } from "@/lib/format";
import { labelFor, TOPIC_LABELS, type Topic } from "@/lib/profile/fields";
import { useWs } from "../context";
import { markFor, valueFor } from "../derive";
import { FieldEditor } from "../FieldEditor";
import { answeredQuestions, currentTopic } from "./shared";

/** "Answered in <topic> · n" with Edit links; "Show all" reveals every answer and the conversation log. */
export function AnsweredCard({ onEdit }: { onEdit: (questionKey: string) => void }) {
  const { ws } = useWs();
  const [all, setAll] = useState(false);
  const answered = useMemo(() => answeredQuestions(ws), [ws]);
  const topic = currentTopic(ws);
  const inTopic = topic ? answered.filter((q) => q.topic === topic) : answered;
  const items = all ? answered : inTopic;
  const turns = ws.turns.filter((t) => t.text !== "[Skipped]" || t.kind !== "answer");
  if (!answered.length && !turns.length) return null;
  const canEdit = ws.permissions.canEdit;

  return (
    <section aria-label="Answered questions" className="shrink-0 rounded-lg border border-line bg-surface">
      <div className="flex items-baseline gap-2 border-b border-line-soft px-4 py-2.5 text-xs font-medium text-muted">
        <h2 className="flex-1">{all || !topic ? `All answers · ${answered.length}` : `Answered in ${TOPIC_LABELS[topic as Topic]} · ${inTopic.length}`}</h2>
        {(answered.length > inTopic.length || turns.length > 0) && (
          <button type="button" className="font-normal text-accent hover:underline" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : "Show all"}
          </button>
        )}
      </div>
      {items.length === 0 && !all && <p className="px-4 py-2.5 text-[13px] text-muted">No answers in this section yet.</p>}
      <ul>
        {items.map((q) => {
          const value = q.targets.map((p) => valueFor(ws, p).text).join(" · ");
          const mark = markFor(ws, q.targets[0]);
          return (
            <li key={q.instanceKey} className="flex min-h-10 items-center gap-3 border-b border-line-soft px-4 py-2 text-[13px] last:border-b-0">
              <span className="min-w-0 flex-1 text-ink-secondary" title={q.prompt}>
                {labelFor(q.targets[0])}
              </span>
              <span className="num text-right font-medium text-ink">{value}</span>
              {mark.kind === "confirmed" ? (
                <span className="text-xs text-ok" aria-label="Confirmed">
                  ✓
                </span>
              ) : (
                <span className={cx("text-xs", mark.kind === "review" || mark.kind === "notconfirmed" ? "text-warn" : "text-muted")} title={mark.label}>
                  <span aria-hidden="true">{mark.kind === "review" || mark.kind === "notconfirmed" ? "⚠︎" : mark.kind === "estimated" ? "◐" : "—"}</span>
                  <span className="sr-only">{mark.label}</span>
                </span>
              )}
              {canEdit && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => onEdit(q.instanceKey)} aria-label={`Edit ${labelFor(q.targets[0])}`}>
                  Edit
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {all && turns.length > 0 && <ConversationLog turns={turns} />}
    </section>
  );
}

function ConversationLog({ turns }: { turns: ReturnType<typeof useWs>["ws"]["turns"] }) {
  return (
    <div className="border-t border-line">
      <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-muted">Conversation log</h3>
      <ol className="flex max-h-[420px] flex-col overflow-y-auto pb-2" aria-live="polite" aria-relevant="additions">
        {turns.map((t) => (
          <li key={t.id} className={cx("flex flex-col gap-0.5 px-4 py-2 text-[13px]", t.author === "assistant" && "bg-subtle")}>
            <span className="text-[11px] text-muted">
              {t.author === "assistant" ? "Assistant" : t.author === "buyer" ? "Client (own words)" : t.kind === "notes" ? "Pasted notes" : "Agent"} · {dateTime(t.createdAt)}
              {t.extractionStatus === "pending" && " · analysing"}
              {t.extractionStatus === "failed" && <span className="text-warn"> · analysis failed</span>}
            </span>
            <p className="whitespace-pre-wrap text-ink-2">{t.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** CON05 Back / Edit answer: pick an earlier question and change its confirmed answer. */
export function EditEarlierAnswer({ initialKey, onClose }: { initialKey: string | null; onClose: () => void }) {
  const { ws, mutate } = useWs();
  const answered = useMemo(() => answeredQuestions(ws), [ws]);
  const [sel, setSel] = useState(initialKey ?? answered[0]?.instanceKey ?? "");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [initialKey]);
  const q = answered.find((x) => x.instanceKey === sel);
  return (
    <section ref={ref} aria-label="Edit an earlier answer" className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4 md:px-5">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-sm font-semibold text-ink">Edit an earlier answer</h2>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {!answered.length ? (
        <p className="text-[13px] text-muted">No earlier answers yet.</p>
      ) : (
        <>
          <Field label="Earlier question (most recent first)" htmlFor="edit-earlier">
            <Select id="edit-earlier" value={sel} onChange={(e) => setSel(e.target.value)}>
              {answered.map((x) => (
                <option key={x.instanceKey} value={x.instanceKey}>
                  {x.prompt}
                </option>
              ))}
            </Select>
          </Field>
          {q?.targets.map((path) => (
            <FieldEditor
              key={`${q.instanceKey}:${path}`}
              path={path}
              initial={ws.profile.confirmed[path]?.value}
              saveLabel="Update answer"
              onSave={(e) =>
                mutate("Update answer", () =>
                  api(`/api/assessments/${ws.assessment.id}/profile`, { method: "PATCH", body: { action: "set", expectedRevision: ws.assessment.currentRevision, fields: [{ path, ...e }] } }),
                )
              }
            />
          ))}
        </>
      )}
    </section>
  );
}
