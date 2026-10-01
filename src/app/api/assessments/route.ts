import { requireAuth } from "@/lib/auth/session";
import { invalid, readJson, route } from "@/lib/http";
import { CreateAssessmentBody, createAssessment, listAssessments } from "@/lib/services/assessments";

/** GET /api/assessments — permission-filtered, paginated cases. */
export const GET = route(async (req) => {
  const ctx = await requireAuth();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  const q = url.searchParams.get("q")?.slice(0, 80) || undefined;
  return Response.json(await listAssessments(ctx, { q, page, pageSize }));
});

/** POST /api/assessments — create an assigned draft case; idempotency key required. */
export const POST = route(async (req, _ctx, correlationId) => {
  const ctx = await requireAuth();
  const key = req.headers.get("idempotency-key");
  if (!key || key.length < 8 || key.length > 100) throw invalid("Idempotency-Key header is required");
  const body = CreateAssessmentBody.parse(await readJson(req));
  const { assessment, created } = await createAssessment(ctx, body, key, correlationId);
  return Response.json({ id: assessment.id, created }, { status: created ? 201 : 200 });
});
