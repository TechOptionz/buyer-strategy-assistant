import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors: Record<string, string> = {},
    public retryable = false,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = () => new ApiError(403, "forbidden", "You do not have access to this resource");
export const conflict = (message: string) => new ApiError(409, "revision_conflict", message, {}, false);
export const invalid = (message: string, fieldErrors: Record<string, string> = {}) =>
  new ApiError(422, "validation_failed", message, fieldErrors);

export function correlationIdFrom(req: Request) {
  const h = req.headers.get("x-correlation-id");
  return h && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
}

/** Uniform error envelope: {code, message, fieldErrors, retryable, correlationId}. */
export function errorResponse(err: unknown, correlationId: string) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { code: err.code, message: err.message, fieldErrors: err.fieldErrors, retryable: err.retryable, correlationId },
      { status: err.status, headers: { "x-correlation-id": correlationId } },
    );
  }
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
    return NextResponse.json(
      { code: "validation_failed", message: "Request validation failed", fieldErrors, retryable: false, correlationId },
      { status: 422 },
    );
  }
  // Never echo internal details (may contain buyer data); log only the type and correlation id.
  console.error(`[${correlationId}] unhandled error`, err instanceof Error ? err.name + ": " + err.message.slice(0, 200) : typeof err);
  return NextResponse.json(
    { code: "internal_error", message: "Something went wrong. Your saved information is unchanged.", fieldErrors: {}, retryable: true, correlationId },
    { status: 500 },
  );
}

type Handler<C> = (req: Request, ctx: C, correlationId: string) => Promise<Response>;

export function route<C>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    const correlationId = correlationIdFrom(req);
    try {
      const res = await fn(req, ctx, correlationId);
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (err) {
      return errorResponse(err, correlationId);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw invalid("Request body must be valid JSON");
  }
}
