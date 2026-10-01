import "server-only";
import { and, eq, max } from "drizzle-orm";
import { AiUnavailableError } from "../ai/anthropic";
import { aiConfig, PROMPT_VERSIONS } from "../ai/config";
import { extractWithAi } from "../ai/intake";
import { type DB, schema } from "../db";
import { extractWithRules } from "../extract/rules";
import { validateExtraction } from "../extract/validate";
import type { ExtractionResult } from "../extract/types";
import { labelFor } from "../profile/fields";
import { insertProposed, loadView } from "./profile";
import { JobError, registerRunner } from "./jobs";

export async function nextSequence(db: Pick<DB, "select">, assessmentId: string) {
  const [row] = await db.select({ m: max(schema.turns.sequence) }).from(schema.turns).where(eq(schema.turns.assessmentId, assessmentId));
  return (row?.m ?? 0) + 1;
}

export async function addAssistantTurn(db: DB, organisationId: string, assessmentId: string, text: string, key: string, questionKey: string | null = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db
        .insert(schema.turns)
        .values({ organisationId, assessmentId, sequence: await nextSequence(db, assessmentId), author: "assistant", kind: "question", text, questionKey, idempotencyKey: key })
        .onConflictDoNothing({ target: [schema.turns.assessmentId, schema.turns.idempotencyKey] });
      return;
    } catch {
      // sequence collision under concurrency → retry with the next number
    }
  }
}

/**
 * Extract proposed facts from text. AI is used when configured; on any AI failure the deterministic
 * extractor runs instead and the failure is reported, so the agent always has a working path.
 */
export async function runExtraction(
  db: DB,
  organisationId: string,
  assessmentId: string,
  text: string,
  sourceTurnId: string,
  sourceType: "notes" | "conversation",
) {
  const view = await loadView(db, assessmentId);
  const cfg = aiConfig();
  let result: ExtractionResult;
  let aiError: string | null = null;
  const started = Date.now();

  if (cfg.enabled) {
    try {
      const ai = await extractWithAi(text, Object.keys(view.state.confirmed));
      result = validateExtraction(text, ai.facts, ai.clarifications, "ai");
      await db.insert(schema.aiCalls).values({
        organisationId, assessmentId, mode: "intake", model: ai.meta.model, promptVersion: PROMPT_VERSIONS.intake,
        outcome: `ok:${ai.meta.attempts}`, latencyMs: Date.now() - started, inputTokens: ai.meta.inputTokens, outputTokens: ai.meta.outputTokens,
      });
    } catch (err) {
      const code = err instanceof AiUnavailableError ? err.code : "provider_error";
      aiError = code;
      await db.insert(schema.aiCalls).values({ organisationId, assessmentId, mode: "intake", model: cfg.model, promptVersion: PROMPT_VERSIONS.intake, outcome: `error:${code}`, latencyMs: Date.now() - started });
      const r = extractWithRules(text);
      result = validateExtraction(text, r.facts, r.clarifications, "rules");
    }
  } else {
    const r = extractWithRules(text);
    result = validateExtraction(text, r.facts, r.clarifications, "rules");
  }

  // Skip proposals that merely repeat an already-confirmed value (CON04).
  const fresh = result.proposedFacts.filter((f) => {
    const c = view.state.confirmed[f.path];
    return !(c && c.state === f.valueState && JSON.stringify(c.value) === JSON.stringify(f.value));
  });
  // Idempotent on retry: replace this turn's still-unreviewed proposals.
  await db
    .delete(schema.facts)
    .where(and(eq(schema.facts.assessmentId, assessmentId), eq(schema.facts.sourceId, sourceTurnId), eq(schema.facts.status, "proposed")));
  const [a] = await db.select({ rev: schema.assessments.currentRevision }).from(schema.assessments).where(eq(schema.assessments.id, assessmentId));
  await insertProposed(db, { organisationId }, assessmentId, a.rev, fresh, { type: sourceType, id: sourceTurnId }, result.engine === "ai" ? "ai" : "rules");

  for (const [i, c] of result.clarifications.entries()) {
    await addAssistantTurn(db, organisationId, assessmentId, `Clarification needed: ${c.question}`, `clarify:${sourceTurnId}:${i}`);
  }
  for (const c of result.conflicts) {
    await addAssistantTurn(db, organisationId, assessmentId, `The notes give different values for ${labelFor(c.path)}. Both are kept as proposals — please confirm which is current.`, `conflict:${sourceTurnId}:${c.path}`);
  }
  await db.update(schema.turns).set({ extractionStatus: "done" }).where(eq(schema.turns.id, sourceTurnId));

  return {
    engine: result.engine,
    aiError,
    proposed: fresh.length,
    duplicatesSkipped: result.proposedFacts.length - fresh.length,
    clarifications: result.clarifications.length,
    conflicts: result.conflicts.map((c) => c.path),
    rejected: result.rejected,
  };
}

registerRunner("extract_notes", async (db, job) => {
  const { text, turnId, sourceType } = job.payload as { text: string; turnId: string; sourceType: "notes" | "conversation" };
  if (!job.assessmentId) throw new JobError("Missing assessment", "bad_payload", false);
  try {
    return await runExtraction(db, job.organisationId, job.assessmentId, text, turnId, sourceType);
  } catch (err) {
    await db.update(schema.turns).set({ extractionStatus: "failed" }).where(eq(schema.turns.id, turnId));
    throw err instanceof JobError ? err : new JobError("Extraction failed", "extraction_failed", true);
  }
});
