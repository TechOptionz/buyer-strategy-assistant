"use client";

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
  retryable: boolean;
  correlationId: string;
}

export class ClientApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, { code: "network", message: "Network error — your changes were not lost. Check the connection and retry.", fieldErrors: {}, retryable: true, correlationId: "" });
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ClientApiError(res.status, data ?? { code: "error", message: `Request failed (${res.status})`, fieldErrors: {}, retryable: res.status >= 500, correlationId: "" });
  return data as T;
}

/** Poll a job until it finishes (bounded). */
export async function waitForJob(jobId: string, onUpdate?: (status: string) => void, timeoutMs = 120_000) {
  const start = Date.now();
  let delay = 600;
  while (Date.now() - start < timeoutMs) {
    const job = await api<{ status: string; result: Record<string, unknown> | null; error: { code: string; message: string } | null }>(`/api/jobs/${jobId}`);
    onUpdate?.(job.status);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(3_000, delay * 1.4);
  }
  return { status: "timeout", result: null, error: { code: "timeout", message: "Still processing — refresh in a moment." } };
}

export const toCents = (dollars: string) => {
  const cleaned = dollars.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const m = cleaned.match(/^(-?\d+(?:\.\d{0,2})?)(k|m)?$/i);
  if (!m) return NaN;
  const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(Number(m[1]) * mult * 100);
};

export const fromCents = (c: number | null | undefined) => (c == null ? "" : String(c / 100));

export const aud = (c: number | null | undefined, cents = false) =>
  c == null ? "—" : (c / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
