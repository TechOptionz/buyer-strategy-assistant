import { z } from "zod";

export const ProposedFactSchema = z.object({
  path: z.string(),
  valueState: z.enum(["value", "unknown", "not_applicable", "declined"]),
  /** Money in integer cents; percentages as numbers; enums as option values. */
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  evidenceText: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ProposedFact = z.infer<typeof ProposedFactSchema>;

export const ClarificationSchema = z.object({
  path: z.string().nullable(),
  question: z.string(),
  evidenceText: z.string(),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export interface ExtractionResult {
  proposedFacts: ProposedFact[];
  clarifications: Clarification[];
  /** Same path, different values within one source — both preserved. */
  conflicts: { path: string; values: ProposedFact[] }[];
  /** Facts dropped by server validation, with reasons (never silently ignored). */
  rejected: { path: string; reason: string }[];
  engine: "rules" | "ai";
}
