import { requireAuth } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { notFound, route } from "@/lib/http";
import { loadAssessment } from "@/lib/access";
import { getJob } from "@/lib/services/jobs";

/** GET /api/jobs/{id} — authorised job status and safe error details. */
export const GET = route(async (_req, ctx: RouteContext<"/api/jobs/[id]">) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const job = await getJob(db, auth, id);
  if (!job) throw notFound("Job");
  if (job.assessmentId) await loadAssessment(auth, job.assessmentId, "view");
  return Response.json({
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    result: job.status === "succeeded" ? job.result : null,
    error: job.status === "failed" ? { code: job.errorCode, message: job.errorMessage } : null,
    updatedAt: job.updatedAt,
  });
});
