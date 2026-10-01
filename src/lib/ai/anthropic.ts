import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { aiConfig } from "./config";

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "timeout" | "provider_error" | "invalid_output" | "refused" | "rate_limited",
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient() {
  const cfg = aiConfig();
  if (!cfg.enabled) throw new AiUnavailableError("AI provider is not configured", "not_configured");
  client ??= new Anthropic({ timeout: cfg.timeoutMs, maxRetries: 2 });
  return client;
}

export interface StructuredCallResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

/**
 * One bounded structured call: JSON-schema constrained output, validated again with Zod on the
 * server. An invalid result is retried once with the validation feedback (Section 10), then fails
 * as a recoverable error so the manual path remains available.
 */
export async function structuredCall<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  validate?: (data: T) => string[];
}): Promise<StructuredCallResult<T>> {
  const cfg = aiConfig();
  const anthropic = getClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Anthropic.Message;
    try {
      response = (await anthropic.beta.messages.create({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system: opts.system,
        messages,
        output_config: { effort: cfg.effort, format: { type: "json_schema", schema: opts.jsonSchema } },
        // Server-side refusal fallback, routed by Anthropic per refusal category.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)) as unknown as Anthropic.Message;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AiUnavailableError("AI provider rate limited", "rate_limited");
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiUnavailableError("AI provider timed out", "timeout");
      if (err instanceof Anthropic.APIError) throw new AiUnavailableError(`AI provider error ${err.status ?? ""}`.trim(), "provider_error");
      throw new AiUnavailableError("AI provider unreachable", "provider_error");
    }
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") throw new AiUnavailableError("AI declined this request", "refused");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let problems: string[] = [];
    let parsed: T | null = null;
    try {
      const result = opts.schema.safeParse(JSON.parse(text));
      if (result.success) {
        parsed = result.data;
        problems = opts.validate?.(parsed) ?? [];
      } else problems = result.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    } catch {
      problems = ["Output was not valid JSON"];
    }
    if (parsed && problems.length === 0) {
      return { data: parsed, model: response.model, inputTokens, outputTokens, attempts: attempt };
    }
    if (response.stop_reason === "max_tokens") problems.push("Output was truncated; be more concise.");
    // Retry once with validation feedback, appending to the conversation (append-only history).
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    messages.push({ role: "user", content: `Your output failed validation:\n- ${problems.join("\n- ")}\nReturn corrected JSON only.` });
  }
  throw new AiUnavailableError("AI output failed validation after one retry", "invalid_output");
}
