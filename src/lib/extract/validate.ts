import { parseMoneyToCents } from "../parse/numbers";
import { fieldDef, isValidPath, validateValue } from "../profile/fields";
import type { Clarification, ExtractionResult, ProposedFact } from "./types";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Coerce an AI-supplied string value into the field's storage type (money → cents). */
export function coerceValue(path: string, raw: unknown): unknown {
  const def = fieldDef(path);
  if (!def || raw == null) return raw;
  if (typeof raw !== "string") return raw;
  switch (def.type) {
    case "money":
      return parseMoneyToCents(raw);
    case "number":
    case "percent": {
      const n = Number(raw.replace(/[%,\s]/g, ""));
      return Number.isFinite(n) ? n : raw;
    }
    case "boolean":
      return /^(true|yes)$/i.test(raw) ? true : /^(false|no)$/i.test(raw) ? false : raw;
    case "list":
      return raw.split(/\s*[,;]\s*/).filter(Boolean);
    default:
      return raw;
  }
}

/**
 * Server-side validation of extraction output (Section 10): field paths, allowed values, and that
 * each evidence quote actually appears in the source. Invalid items are reported, never silently
 * applied. Same-path disagreements are preserved as conflicts (INT04).
 */
export function validateExtraction(
  sourceText: string,
  facts: ProposedFact[],
  clarifications: Clarification[],
  engine: "rules" | "ai",
): ExtractionResult {
  const source = norm(sourceText);
  const accepted: ProposedFact[] = [];
  const rejected: { path: string; reason: string }[] = [];

  for (const f of facts) {
    if (!isValidPath(f.path)) {
      rejected.push({ path: f.path, reason: "Unknown field" });
      continue;
    }
    if (!f.evidenceText || !source.includes(norm(f.evidenceText))) {
      rejected.push({ path: f.path, reason: "Supporting text not found in the source" });
      continue;
    }
    if (f.valueState !== "value") {
      accepted.push({ ...f, value: null });
      continue;
    }
    const v = validateValue(f.path, coerceValue(f.path, f.value));
    if (!v.ok) {
      rejected.push({ path: f.path, reason: v.error });
      continue;
    }
    accepted.push({ ...f, value: v.value as ProposedFact["value"] });
  }

  const byPath = new Map<string, ProposedFact[]>();
  for (const f of accepted) byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
  const conflicts: ExtractionResult["conflicts"] = [];
  for (const [path, list] of byPath) {
    const distinct = list.filter((f, i) => list.findIndex((g) => JSON.stringify(g.value) === JSON.stringify(f.value) && g.valueState === f.valueState) === i);
    if (distinct.length > 1) conflicts.push({ path, values: distinct });
  }

  const cleanClarifications = clarifications
    .filter((c) => c.question.trim().length > 0)
    .map((c) => ({ ...c, path: c.path && isValidPath(c.path) ? c.path : null }));

  // Keep one copy of each identical fact (the first supporting sentence).
  const deduped = accepted.filter(
    (f, i) => accepted.findIndex((g) => g.path === f.path && JSON.stringify(g.value) === JSON.stringify(f.value)) === i,
  );
  return { proposedFacts: deduped, clarifications: cleanClarifications, conflicts, rejected, engine };
}
