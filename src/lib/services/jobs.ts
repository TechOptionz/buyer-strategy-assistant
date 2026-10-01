import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import type { AuthContext } from "../auth/session";
import { type DB, getDb, schema } from "../db";

export type JobType = (typeof schema.jobs.$inferSelect)["type"];
export class JobError extends Error {
  constructor(message: string, public code: string, public retryable: boolean) {
    super(message);
  }
}

type Runner = (db: DB, job: typeof schema.jobs.$inferSelect) => Promise<Record<string, unknown>>;
const runners = new Map<JobType, Runner>();
export function registerRunner(type: JobType, fn: Runner) {
  runners.set(type, fn);
}

/** Create a job once per idempotency key; a repeated request returns the existing job. */
export async function enqueue(
  db: DB,
  ctx: AuthContext,
  type: JobType,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  assessmentId: string | null,
) {
  const inserted = await db
    .insert(schema.jobs)
    .values({ organisationId: ctx.organisationId, assessmentId, type, payload, idempotencyKey, createdById: ctx.userId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    const job = inserted[0];
    after(() => runJob(job.id));
    return { job, created: true };
  }
  const [existing] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.organisationId, ctx.organisationId), eq(schema.jobs.type, type), eq(schema.jobs.idempotencyKey, idempotencyKey)));
  return { job: existing, created: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Execute with a capped number of attempts; only retryable errors are retried, with backoff and jitter. */
export async function runJob(jobId: string) {
  const db = await getDb();
  const [claimed] = await db
    .update(schema.jobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "queued")))
    .returning();
  if (!claimed) return;
  const runner = runners.get(claimed.type);
  let job = claimed;
  for (;;) {
    job = { ...job, attempts: job.attempts + 1 };
    await db.update(schema.jobs).set({ attempts: sql`${schema.jobs.attempts} + 1` }).where(eq(schema.jobs.id, jobId));
    try {
      if (!runner) throw new JobError("No runner for job type", "no_runner", false);
      const result = await runner(db, job);
      await db.update(schema.jobs).set({ status: "succeeded", result, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
      return;
    } catch (err) {
      const je = err instanceof JobError ? err : new JobError("Unexpected job failure", "internal", false);
      if (!(err instanceof JobError)) console.error(`[job ${jobId}] ${err instanceof Error ? err.name : "error"}`);
      if (je.retryable && job.attempts < job.maxAttempts) {
        const base = 500 * 2 ** (job.attempts - 1);
        await sleep(Math.min(8_000, base) + Math.random() * 250);
        continue;
      }
      await db
        .update(schema.jobs)
        .set({ status: "failed", errorCode: je.code, errorMessage: je.message.slice(0, 300), updatedAt: new Date() })
        .where(eq(schema.jobs.id, jobId));
      return;
    }
  }
}

export async function getJob(db: DB, ctx: AuthContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.id, id), eq(schema.jobs.organisationId, ctx.organisationId)));
  return job ?? null;
}
