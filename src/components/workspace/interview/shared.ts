"use client";

import { expandQuestions, OUTPUT_LABELS, type ExpandedQuestion, type OutputKey } from "@/lib/interview/registry";
import { fieldDef, FIELDS, type Topic } from "@/lib/profile/fields";
import type { Workspace } from "@/lib/services/assessments";

type WS = Workspace;
export type Step = WS["next"];
export type QStep = Extract<Step, { kind: "question" }>;
export type Proposed = WS["profile"]["proposed"][number];

/** "funding ceiling" — lower-case output names for running text. */
export const outputText = (o: string) => (OUTPUT_LABELS[o as OutputKey] ?? o.replaceAll("_", " ")).toLowerCase();
export const outputList = (outs: string[]) => {
  const t = outs.map((o) => OUTPUT_LABELS[o as OutputKey] ?? o.replaceAll("_", " "));
  return t.length > 1 ? `${t.slice(0, -1).join(", ")} and ${t.at(-1)}` : (t[0] ?? "");
};

export const topicOf = (path: string): Topic | undefined => fieldDef(path)?.topic;

/** Registry order of fields, for stable ordering inside a topic group. */
const FIELD_ORDER = new Map(FIELDS.map((f, i) => [f.path, i]));
export const fieldOrder = (path: string) => FIELD_ORDER.get(path.replace(/\.\d+\./g, ".*.")) ?? 9_999;

export function questionsFor(ws: WS): ExpandedQuestion[] {
  return expandQuestions(ws.profile.propertyIndexes.length ? ws.profile.propertyIndexes : [1]);
}

/** The topic the interview is on now: the current question's topic, or the conflict's field topic. */
export function currentTopic(ws: WS): Topic | undefined {
  const s = ws.next;
  if (s.kind === "question") return s.question.topic as Topic;
  if (s.kind === "conflict") return topicOf(s.path);
  return undefined;
}

/** Field paths the current step is asking about (for the "Asking now" summary row). */
export function currentPaths(ws: WS): string[] {
  const s = ws.next;
  if (s.kind === "question") return s.question.targets;
  if (s.kind === "conflict") return [s.path];
  return [];
}

/** Answered questions, most recent first (excludes skips). */
export function answeredQuestions(ws: WS): ExpandedQuestion[] {
  const qs = questionsFor(ws);
  const keys: string[] = [];
  for (const t of [...ws.turns].reverse()) if (t.kind === "answer" && t.questionKey && t.text !== "[Skipped]" && !keys.includes(t.questionKey)) keys.push(t.questionKey);
  return keys.map((k) => qs.find((q) => q.instanceKey === k)).filter(Boolean) as ExpandedQuestion[];
}

/** Outputs a field blocks, from the questions that target it. */
export function blockedOutputs(ws: WS, path: string): string[] {
  const outs = new Set<string>();
  for (const q of questionsFor(ws)) if (q.targets.includes(path)) for (const o of q.requiredFor) outs.add(o);
  return [...outs];
}

/** A suggested fact that needs a decision rather than a plain confirm. */
export function needsDecision(ws: WS, f: Proposed): boolean {
  return !!ws.profile.conflicts[f.fieldPath] || f.conflictsWithConfirmed || ws.profile.proposed.filter((p) => p.fieldPath === f.fieldPath).length > 1;
}
