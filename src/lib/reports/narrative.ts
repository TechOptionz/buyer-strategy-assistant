/**
 * Controlled narrative (REP02). Narrative text may only reference numbers through placeholders
 * `{{ref}}` that resolve to saved, formatted values. Any digit outside a placeholder fails
 * validation, so the AI (or a template bug) cannot introduce an unreferenced figure.
 */

export const SECTION_KEYS = [
  "executive_summary",
  "buyer_goals",
  "financial_overview",
  "options",
  "area_comparison",
  "purchase_scenarios",
  "downside_cases",
  "assumptions",
  "next_steps",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  executive_summary: "Executive summary",
  buyer_goals: "Buyer goals",
  financial_overview: "Financial overview",
  options: "Options considered",
  area_comparison: "Area comparison",
  purchase_scenarios: "Purchase scenarios",
  downside_cases: "Downside cases",
  assumptions: "Assumptions and limitations",
  next_steps: "Next steps",
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

export interface NarrativeValidation {
  ok: boolean;
  errors: string[];
}

/** Words that may legitimately contain digits (area or scenario names supplied as data). */
export function validateNarrative(text: string, values: Record<string, string>, allowedTokens: string[] = []): NarrativeValidation {
  const errors: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!(m[1] in values)) errors.push(`Unknown reference {{${m[1]}}}`);
  let stripped = text.replace(PLACEHOLDER, "");
  for (const t of allowedTokens) if (/\d/.test(t)) stripped = stripped.split(t).join("");
  const digit = stripped.match(/[^\s]*\d[^\s]*/);
  if (digit) errors.push(`Number "${digit[0]}" is not backed by a saved value reference`);
  return { ok: errors.length === 0, errors };
}

export function renderNarrative(text: string, values: Record<string, string>) {
  return text.replace(PLACEHOLDER, (_, ref: string) => values[ref] ?? "[missing value]");
}
