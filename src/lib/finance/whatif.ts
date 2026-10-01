import { parseMoneyToCents, parseNumberToken } from "../parse/numbers";
import type { ScenarioChange } from "./patch";

export interface WhatIfClarification {
  question: string;
  options: { label: string; changes: ScenarioChange[] }[];
}

export interface WhatIfProposal {
  changes: ScenarioChange[];
  clarifications: WhatIfClarification[];
  unrecognised: string[];
}

const NUM = String.raw`(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)`;

/**
 * Deterministic interpretation of natural-language what-if questions into a PROPOSED patch.
 * Nothing is calculated until the agent runs the proposal (ANA02).
 *
 * Rate changes distinguish percentage points from relative percent changes (AT06). A bare "%"
 * on a rate change is ambiguous and produces a clarification rather than a guess.
 */
export function parseWhatIf(text: string): WhatIfProposal {
  const out: WhatIfProposal = { changes: [], clarifications: [], unrecognised: [] };
  const clauses = text
    .toLowerCase()
    .split(/\band\b|;|,(?!\d{3})|\balso\b/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const before = out.changes.length + out.clarifications.length;
    const sign = /\b(fall|falls|drop|drops|decrease|decreases|lower|down|reduce|reduces|cut)\b/.test(clause) ? -1 : 1;

    if (/\b(rate|rates|interest)\b/.test(clause)) {
      const pp = clause.match(new RegExp(`${NUM}\\s*(percentage points?|pp|ppt|points?|basis points|bps)`));
      const relative = clause.match(new RegExp(`${NUM}\\s*(%|percent|per cent)\\s*(relative|of (the )?(current )?rate)`));
      const to = clause.match(new RegExp(`\\bto\\s*${NUM}\\s*(%|percent|per cent)`));
      const bare = clause.match(new RegExp(`${NUM}\\s*(%|percent|per cent)`));
      if (pp) {
        let v = parseNumberToken(pp[1])!;
        if (/basis points|bps/.test(pp[2])) v = v / 100;
        out.changes.push({ op: "rate_add_pp", pp: sign * v });
      } else if (relative) {
        out.changes.push({ op: "rate_scale_relative_pct", pct: sign * parseNumberToken(relative[1])! });
      } else if (to) {
        out.changes.push({ op: "set_rate", pct: parseNumberToken(to[1])! });
      } else if (bare) {
        const v = parseNumberToken(bare[1])!;
        out.clarifications.push({
          question: `Does "${v}%" mean ${v} percentage points, or a ${v}% relative change in the current rate?`,
          options: [
            { label: `${sign < 0 ? "−" : "+"}${v} percentage points`, changes: [{ op: "rate_add_pp", pp: sign * v }] },
            { label: `${sign < 0 ? "−" : "+"}${v}% of the current rate (relative)`, changes: [{ op: "rate_scale_relative_pct", pct: sign * v }] },
          ],
        });
      }
      if (/interest[- ]only/.test(clause)) out.changes.push({ op: "set_repayment", repayment: "interest_only" });
    } else if (/principal (and|&) interest|\bp ?& ?i\b/.test(clause)) {
      out.changes.push({ op: "set_repayment", repayment: "principal_and_interest" });
    } else if (/interest[- ]only/.test(clause)) {
      out.changes.push({ op: "set_repayment", repayment: "interest_only" });
    } else if (/\bvacan(t|cy)\b/.test(clause)) {
      const w = clause.match(new RegExp(`${NUM}\\s*(more\\s*|extra\\s*|additional\\s*)?weeks?`));
      if (w) {
        if (w[2]) out.unrecognised.push(`${clause} (state the total vacant weeks, e.g. "4 weeks vacancy")`);
        else out.changes.push({ op: "set_vacant_weeks", weeks: parseNumberToken(w[1])! });
      }
    } else if (/\brent\b/.test(clause)) {
      const rel = clause.match(new RegExp(`${NUM}\\s*(%|percent|per cent)`));
      const amount = parseMoneyToCents(clause);
      if (rel) out.changes.push({ op: "rent_scale_relative_pct", pct: sign * parseNumberToken(rel[1])! });
      else if (amount != null) out.changes.push({ op: "set_weekly_rent", cents: amount });
    } else if (/\bvaluation|values? (at|comes in)|valued\b/.test(clause)) {
      const rel = clause.match(new RegExp(`${NUM}\\s*(%|percent|per cent)`));
      const amount = parseMoneyToCents(clause);
      if (rel) out.changes.push({ op: "valuation_scale_relative_pct", pct: sign * parseNumberToken(rel[1])! });
      else if (amount != null) out.changes.push({ op: "set_valuation", cents: amount });
    } else if (/\bdeposit\b/.test(clause)) {
      const amount = parseMoneyToCents(clause);
      if (amount != null) out.changes.push({ op: "set_deposit", cents: amount });
    } else if (/\bequity\b/.test(clause)) {
      const amount = parseMoneyToCents(clause);
      if (amount != null) out.changes.push({ op: "set_equity_draw", cents: amount });
    } else if (/\bloan\b/.test(clause)) {
      const amount = parseMoneyToCents(clause);
      if (amount != null) out.changes.push({ op: "set_purchase_loan", cents: amount });
    } else if (/\b(repair|repairs|maintenance|works|cost|costs)\b/.test(clause)) {
      const amount = parseMoneyToCents(clause);
      if (amount != null) out.changes.push({ op: "add_annual_cost", label: "Additional repairs/costs", cents: amount });
    } else if (/\b(price|pay|buy|purchase|offer)\b/.test(clause)) {
      const amount = parseMoneyToCents(clause);
      if (amount != null) out.changes.push({ op: "set_price", cents: amount, alsoValuation: true });
    }

    if (out.changes.length + out.clarifications.length === before && !out.unrecognised.some((u) => u.startsWith(clause))) {
      if (!/^(what if|what happens if|if)$/.test(clause)) out.unrecognised.push(clause);
    }
  }
  return out;
}
