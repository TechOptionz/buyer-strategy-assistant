import "server-only";

export const PROMPT_VERSIONS = {
  intake: "intake-2026-10-01.1",
  report: "report-2026-10-01.1",
} as const;

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "none")) as "anthropic" | "none";
  return {
    provider,
    enabled: provider === "anthropic" && !!process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL ?? "claude-opus-5-5",
    effort: (process.env.AI_EFFORT ?? "medium") as "low" | "medium" | "high",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 45_000),
    maxTokens: Number(process.env.AI_MAX_TOKENS ?? 8_000),
    /** Hard cap on input characters per call (cost control). */
    maxInputChars: Number(process.env.AI_MAX_INPUT_CHARS ?? 40_000),
  };
}
