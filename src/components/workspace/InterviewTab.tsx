"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, cx, Spinner } from "@/components/ui";
import { useWs } from "./context";
import { ConflictCard } from "./interview/ConflictCard";
import { AnsweredCard, EditEarlierAnswer } from "./interview/History";
import { NotesCard, usePasteNotes } from "./interview/NotesCard";
import { QuestionCard } from "./interview/QuestionCard";
import { currentTopic, topicOf } from "./interview/shared";
import { LivePanel, SummaryPeek } from "./LivePanel";
import { ProposedFacts } from "./ProposedFacts";

export function InterviewTab({ startNotes }: { startNotes: boolean }) {
  const { ws } = useWs();
  const canEdit = ws.permissions.canEdit;
  const hasNotes = ws.turns.some((t) => t.kind === "notes");
  const paste = usePasteNotes(startNotes || !hasNotes);
  const [edit, setEdit] = useState<{ key: string | null; n: number } | null>(null);
  const openEdit = (key: string | null) => setEdit((e) => ({ key, n: (e?.n ?? 0) + 1 }));

  // Notes mode: suggested facts are waiting, or the case was opened to paste notes.
  const notesMode = startNotes || ws.profile.proposed.length > 0 || ws.next.kind === "review_proposed";
  const step = <StepPanel />;
  const backRow = canEdit && (
    <div className="flex items-center gap-4 text-[13px]">
      <button type="button" className="text-accent hover:underline" onClick={() => (edit ? setEdit(null) : openEdit(null))} aria-expanded={!!edit}>
        ← Back
      </button>
      <span className="flex-1" />
      <Link href="/cases">Save and continue later</Link>
    </div>
  );
  const editPanel = canEdit && edit && <EditEarlierAnswer key={`${edit.key}:${edit.n}`} initialKey={edit.key} onClose={() => setEdit(null)} />;

  return (
    <div className="flex flex-1 flex-col">
      <Stepper />
      <div className="flex flex-1 gap-8 bg-app px-4 py-6 md:px-8">
        <div className={cx("flex min-w-0 flex-1 flex-col", notesMode ? "max-w-[720px] gap-4" : "max-w-[680px] gap-5")}>
          {ws.pendingJobs.length > 0 && <Spinner label="Processing notes in the background…" />}
          {!canEdit && (
            <Alert tone="neutral" title="Read-only">
              You can view the interview, the answers so far and the client summary, but not answer questions or confirm facts.
            </Alert>
          )}
          {notesMode ? (
            <>
              <NotesCard paste={paste} />
              {step}
              {ws.next.kind === "question" && backRow}
              {editPanel}
              <ProposedFacts />
              <AnsweredCard onEdit={openEdit} />
              {ws.next.kind !== "question" && backRow}
            </>
          ) : (
            <>
              <AnsweredCard onEdit={openEdit} />
              {editPanel}
              {step}
              {backRow}
              <ProposedFacts />
              <NotesCard paste={paste} compact />
            </>
          )}
        </div>
        <aside className="hidden w-[380px] shrink-0 self-start lg:sticky lg:top-6 lg:block">
          <LivePanel />
        </aside>
      </div>
      <SummaryPeek />
    </div>
  );
}

/** Section stepper: ✓ done · ⚠︎ review · ● current · ○ todo. Compact one-liner on mobile. */
function Stepper() {
  const { ws } = useWs();
  const current = currentTopic(ws);
  const reviewTopics = new Set<string>([...Object.keys(ws.profile.conflicts), ...ws.profile.proposed.map((f) => f.fieldPath)].map((p) => topicOf(p) ?? ""));
  const steps = ws.progress.map((p) => ({
    ...p,
    state: p.topic === current ? ("current" as const) : reviewTopics.has(p.topic) ? ("review" as const) : p.answered >= p.total ? ("done" as const) : ("todo" as const),
  }));
  if (!steps.length) return null;
  const idx = steps.findIndex((s) => s.state === "current");
  const cur = idx >= 0 ? steps[idx] : null;
  const MARK = { done: ["✓", "text-ok", "Done"], review: ["⚠︎", "text-warn", "Needs review"], current: ["●", "text-accent", "Current"], todo: ["○", "text-faint", "Not started"] } as const;
  return (
    <nav aria-label="Interview sections" className="border-b border-line bg-surface">
      <p className="px-4 py-2.5 text-[13px] md:hidden">
        {cur ? (
          <>
            <span className="font-medium">{cur.label}</span>
            <span className="text-muted">
              {" "}
              · section {idx + 1} of {steps.length}
              {cur.total > 1 && ` · question ${Math.min(cur.answered + 1, cur.total)} of ${cur.total}`}
            </span>
          </>
        ) : (
          <span className="text-muted">
            {steps.filter((s) => s.state === "done").length} of {steps.length} sections complete
          </span>
        )}
      </p>
      <ol className="hidden items-center gap-1 overflow-x-auto px-8 py-2.5 md:flex">
        {steps.map((s, i) => {
          const [icon, cls, word] = MARK[s.state];
          return (
            <li key={s.topic} className="flex shrink-0 items-center gap-1" aria-current={s.state === "current" ? "step" : undefined}>
              <span
                className={cx(
                  "flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] whitespace-nowrap",
                  s.state === "current" ? "bg-accent-tint font-medium text-accent" : s.state === "todo" ? "text-muted" : "text-ink-2",
                )}
                title={`${s.answered} of ${s.total} answered`}
              >
                <span aria-hidden="true" className={cx("text-[11px]", cls)}>
                  {icon}
                </span>
                {s.label}
                <span className="sr-only"> — {word}</span>
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="text-xs text-line-strong">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepPanel() {
  const { ws, goTab } = useWs();
  const step = ws.next;
  if (!ws.permissions.canEdit) return null;
  switch (step.kind) {
    case "question":
      return <QuestionCard key={`${step.question.key}:${ws.assessment.currentRevision}`} step={step} />;
    case "conflict":
      return <ConflictCard key={`${step.path}:${ws.assessment.currentRevision}`} path={step.path} label={step.label} />;
    case "goal_conflict":
      return (
        <Panel tone="warn" eyebrow="⚠︎ Goals conflict" title="The goals cannot all be met — which constraint can change?">
          <p className="text-sm text-ink-2">{step.conflict.description}</p>
          <p className="text-[13px] text-ink-secondary">Nothing is relaxed automatically. Change one of these in the client profile:</p>
          <ul className="flex flex-wrap gap-2">
            {step.conflict.constraints.map((c) => (
              <li key={c.path}>
                <Badge tone="warn">{c.label}</Badge>
              </li>
            ))}
          </ul>
          <div className="pt-1">
            <Button variant="primary" onClick={() => goTab("profile")}>
              Edit constraints in the profile
            </Button>
          </div>
        </Panel>
      );
    case "review_proposed":
      return (
        <Panel eyebrow="◐ Suggested facts waiting" title="Review the suggested facts">
          <p className="text-sm text-ink-2">
            {step.count} suggested fact{step.count > 1 ? "s are" : " is"} waiting for a decision before the interview continues. Nothing is used in calculations until confirmed.
          </p>
          <div className="pt-1">
            <Button variant="primary" onClick={() => document.getElementById("suggested-facts")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Go to suggested facts
            </Button>
          </div>
        </Panel>
      );
    case "done":
      return (
        <Panel tone="ok" eyebrow="✓ Interview complete" title="Every required question is answered or left as a visible gap">
          <p className="text-sm text-ink-2">Optional preferences can still be added in the client profile.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={() => goTab("scenarios")}>
              Go to the scenario lab
            </Button>
            <Button onClick={() => goTab("research")}>Compare areas</Button>
          </div>
        </Panel>
      );
  }
}

function Panel({ tone, eyebrow, title, children }: { tone?: "warn" | "ok"; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cx("-mx-4 overflow-hidden border-y bg-surface md:mx-0 md:rounded-lg md:border", tone === "warn" ? "border-warn-line" : "border-line")}>
      <header className={cx("flex flex-col gap-1 border-b px-4 py-3.5 md:px-5", tone === "warn" ? "border-warn-line bg-warn-tint" : "border-line")}>
        <span className={cx("text-xs font-medium", tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-muted")}>{eyebrow}</span>
        <h2 className="text-lg leading-[1.4] font-semibold text-ink">{title}</h2>
      </header>
      <div className="flex flex-col gap-3 px-4 py-4 md:px-5">{children}</div>
    </section>
  );
}

