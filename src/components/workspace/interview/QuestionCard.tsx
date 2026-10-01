"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AffixInput, Button, cx, Field, Segmented, TextArea, TextInput } from "@/components/ui";
import { api, newKey, toCents, waitForJob } from "@/lib/client/api";
import { TOPIC_LABELS, type Topic } from "@/lib/profile/fields";
import { useWs } from "../context";
import { outputList, outputText, type QStep } from "./shared";
import { AREA_PATHS, AreaInput } from "../AreaInput";

type Action = "answer" | "not_sure" | "skip" | "decline" | "free_text";
const LETTERS = "ABCDEFGHIJ";

/** One guided question: lettered choices or a typed input, own-words answer, and the escape hatches. */
export function QuestionCard({ step }: { step: QStep }) {
  const { ws, mutate, notify } = useWs();
  const q = step.question;
  const key = useRef(newKey());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [text, setText] = useState("");
  const [period, setPeriod] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [mode, setMode] = useState<"structured" | "free">("structured");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const isChoice = q.answerType === "single_choice" || q.answerType === "boolean";
  const options = useMemo(
    () =>
      q.options ?? [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    [q.options],
  );
  const inputId = `answer-${q.key}`;

  // Move focus to the new question only when the user was working inside the card (keyboard flow).
  useEffect(() => {
    if (sessionStorage.getItem("bsa-focus-question") === "1") {
      sessionStorage.removeItem("bsa-focus-question");
      headingRef.current?.focus();
    }
  }, []);

  const send = useCallback(
    async (action: Action, answer?: { value: unknown; frequency?: string }, freeTextValue?: string) => {
      setBusy(true);
      sessionStorage.setItem("bsa-focus-question", "1");
      const res = await mutate("Save answer", () =>
        api<{ jobId: string | null }>(`/api/assessments/${ws.assessment.id}/turns`, {
          body: { idempotencyKey: key.current, expectedRevision: ws.assessment.currentRevision, action, questionKey: q.key, answer, text: freeTextValue },
        }),
      );
      if (res?.jobId) {
        const job = await waitForJob(res.jobId);
        if (job.status === "succeeded") notify("info", "Your free-text answer was analysed. Review the suggested facts before continuing.");
        else notify("bad", `Could not analyse the answer: ${job.error?.message ?? "unknown error"}. Enter the value directly instead.`);
        await mutate("Refresh", async () => null);
      }
      setBusy(false);
    },
    [mutate, notify, q.key, ws.assessment.currentRevision, ws.assessment.id],
  );

  const confirm = useCallback(() => {
    if (busy) return;
    if (mode === "free") {
      if (!freeText.trim()) return setError("Write the answer in your own words, or choose an answer above");
      setError(undefined);
      return void send("free_text", undefined, freeText);
    }
    if (isChoice) {
      if (choice == null) return setError("Choose an answer");
      setError(undefined);
      return void send("answer", { value: q.answerType === "boolean" ? choice === "true" : choice });
    }
    let value: unknown = text;
    if (q.answerType === "money" || q.answerType === "money_period") {
      const c = toCents(text);
      if (c == null || Number.isNaN(c)) return setError("Enter an amount like 85000, 85k or 1.2m (0 is an explicit zero)");
      value = c;
      if (q.answerType === "money_period" && !period) return setError("Choose how often");
    } else if (q.answerType === "number" || q.answerType === "percent") {
      if (text.trim() === "" || !Number.isFinite(Number(text))) return setError("Enter a number");
      value = Number(text);
    } else if (q.answerType === "list") {
      value = text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      if (!(value as string[]).length) return setError("Enter at least one");
    } else if (!text.trim()) return setError("Enter an answer");
    setError(undefined);
    void send("answer", { value, frequency: period || undefined });
  }, [busy, choice, freeText, isChoice, mode, period, q.answerType, send, text]);

  // Keyboard: A/B/C… select a choice, Enter confirms (outside text fields and buttons).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (document.querySelector("dialog[open], [aria-modal='true']")) return;
      if (isChoice && e.key.length === 1) {
        const i = LETTERS.indexOf(e.key.toUpperCase());
        if (i >= 0 && i < options.length) {
          e.preventDefault();
          setChoice(options[i].value);
          setMode("structured");
          setError(undefined);
        }
        return;
      }
      if (e.key === "Enter" && tag !== "BUTTON" && tag !== "A") {
        if ((isChoice && choice != null) || mode === "free") {
          e.preventDefault();
          confirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choice, confirm, isChoice, mode, options]);

  const onFieldEnter = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      confirm();
    }
  };

  const topic = q.topic as Topic;
  const prog = ws.progress.find((p) => p.topic === topic);
  const eyebrow = [
    TOPIC_LABELS[topic],
    prog && prog.total > 1 ? `question ${Math.min(prog.answered + 1, prog.total)} of ${prog.total}` : null,
    step.stage === "optional" ? "optional" : step.stage === "purpose" ? "first question" : null,
    q.requiredFor.length ? `required for ${outputList(q.requiredFor)}` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Current question" className="-mx-4 flex flex-col gap-5 border-y border-line bg-surface px-4 py-6 md:mx-0 md:rounded-lg md:border md:px-8 md:py-7">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">{eyebrow.join(" · ")}</span>
        <h2 ref={headingRef} tabIndex={-1} aria-live="polite" className="text-xl leading-[1.35] font-semibold text-pretty text-ink outline-none md:text-lg md:leading-[1.4]">
          {q.prompt}
        </h2>
        {q.reason && <p className="text-[13px] leading-normal text-ink-secondary">{q.reason}</p>}
      </div>

      {isChoice ? (
        <div role="radiogroup" aria-label="Answers" className="flex flex-col gap-2">
          {options.map((o, i) => {
            const on = choice === o.value && mode === "structured";
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => {
                  setChoice(o.value);
                  setMode("structured");
                  setError(undefined);
                }}
                onKeyDown={(e) => {
                  // Enter on the selected choice confirms it; on another choice it selects that one.
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (on) confirm();
                  else {
                    setChoice(o.value);
                    setMode("structured");
                    setError(undefined);
                  }
                }}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded border px-3.5 text-left text-base transition-colors md:min-h-11 md:text-sm",
                  on ? "border-accent bg-accent-wash font-medium" : "border-line-strong bg-surface hover:bg-hover",
                )}
              >
                <span aria-hidden="true" className="hidden h-[22px] w-[22px] shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-xs font-medium text-ink-secondary md:flex">
                  {LETTERS[i]}
                </span>
                <span className="flex-1 py-2">{o.label}</span>
                {on && <span className="text-sm text-accent md:text-xs">✓ Selected</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Field label="Your answer" htmlFor={inputId} error={mode === "structured" ? error : undefined}>
            {q.answerType === "money" || q.answerType === "money_period" ? (
              <AffixInput
                id={inputId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                prefix="$"
                value={text}
                onChange={(e) => (setText(e.target.value), setMode("structured"))}
                onKeyDown={onFieldEnter}
                invalid={!!error && mode === "structured"}
                placeholder="e.g. 85000 or 85k"
                className="h-11 md:h-9"
                inputClassName="text-base md:text-sm"
              />
            ) : q.answerType === "percent" ? (
              <AffixInput
                id={inputId}
                type="number"
                inputMode="decimal"
                step="any"
                value={text}
                onChange={(e) => (setText(e.target.value), setMode("structured"))}
                onKeyDown={onFieldEnter}
                invalid={!!error && mode === "structured"}
                suffix="%"
                className="h-11 md:h-9"
                inputClassName="text-base md:text-sm"
              />
            ) : q.answerType === "number" ? (
              <AffixInput
                id={inputId}
                type="number"
                inputMode="decimal"
                step="any"
                value={text}
                onChange={(e) => (setText(e.target.value), setMode("structured"))}
                onKeyDown={onFieldEnter}
                invalid={!!error && mode === "structured"}
                className="h-11 md:h-9"
                inputClassName="text-base md:text-sm"
              />
            ) : q.answerType === "text" ? (
              <TextArea id={inputId} value={text} onChange={(e) => (setText(e.target.value), setMode("structured"))} onKeyDown={onFieldEnter} className="text-base md:text-sm" />
            ) : q.answerType === "list" && q.targets.some((t) => AREA_PATHS.has(t)) ? (
              <AreaInput
                id={inputId}
                value={text}
                onChange={(v) => (setText(v), setMode("structured"))}
                suggestions={ws.knownAreas}
                onSubmit={confirm}
                invalid={!!error && mode === "structured"}
                large
              />
            ) : (
              <TextInput
                id={inputId}
                value={text}
                onChange={(e) => (setText(e.target.value), setMode("structured"))}
                onKeyDown={onFieldEnter}
                type={q.answerType === "date" ? "date" : "text"}
                placeholder={q.answerType === "list" ? "Separate with commas, e.g. Ipswich, Logan Central" : undefined}
                invalid={!!error && mode === "structured"}
                className="h-11 text-base md:h-9 md:text-sm"
              />
            )}
          </Field>
          {q.answerType === "money_period" && q.options && (
            <Segmented label="How often" value={period} options={q.options.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => (setPeriod(v), setMode("structured"))} />
          )}
        </div>
      )}

      {isChoice && error && mode === "structured" && (
        <p role="alert" className="-mt-3 text-xs text-bad">
          <span aria-hidden="true">⚠︎ </span>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${inputId}-free`} className="text-[13px] font-medium text-ink-secondary">
          Or answer in your own words
        </label>
        <TextArea
          id={`${inputId}-free`}
          rows={1}
          value={freeText}
          onChange={(e) => {
            setFreeText(e.target.value);
            setMode(e.target.value.trim() ? "free" : "structured");
            setError(undefined);
          }}
          onKeyDown={onFieldEnter}
          placeholder="e.g. “Broker said the limit covers both loans”"
          invalid={!!error && mode === "free"}
          className="min-h-11 py-2.5 text-base"
          aria-describedby={`${inputId}-free-hint`}
        />
        <p id={`${inputId}-free-hint`} className={cx("text-xs", error && mode === "free" ? "text-bad" : "text-muted")}>
          {error && mode === "free" ? `⚠︎ ${error}` : mode === "free" ? "Confirm sends your words for analysis. Facts found are suggested for you to confirm; nothing is used until confirmed." : "Shift+Enter for a new line."}
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-1 md:flex-row md:flex-wrap md:items-center md:gap-2">
        <Button variant="primary" disabled={busy || (isChoice && choice == null && mode === "structured")} onClick={confirm} className="h-12 w-full text-base md:h-9 md:w-auto md:text-sm">
          {busy ? "Saving…" : mode === "free" ? "Confirm and analyse" : "Confirm"}
        </Button>
        <span className="hidden text-xs text-muted md:inline">or press Enter ↵</span>
        <span className="hidden flex-1 md:block" />
        <div className="flex flex-wrap items-center gap-x-4 md:gap-x-0">
          <Button variant="tertiary" disabled={busy} onClick={() => send("not_sure")} className="text-[15px] md:text-sm">
            Not sure
          </Button>
          <Button variant="tertiary" disabled={busy} onClick={() => send("decline")} className="text-[15px] md:text-sm">
            Prefer not to say
          </Button>
          <Button
            variant="tertiary"
            disabled={busy}
            onClick={() => send("skip")}
            title={q.optional ? undefined : "The gap stays visible and affected outputs remain incomplete"}
            className="text-[15px] md:text-sm"
          >
            {q.optional ? "Skip" : "Skip for now"}
          </Button>
        </div>
      </div>
      {!q.optional && q.requiredFor.length > 0 && (
        <p className="-mt-2 text-xs text-muted">Skipping keeps a visible gap: the {q.requiredFor.map(outputText).join(", ")} will stay incomplete.</p>
      )}
    </section>
  );
}
