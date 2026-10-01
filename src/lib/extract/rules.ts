import { parseMoneyToCents, parseNumberToken } from "../parse/numbers";
import type { Clarification, ProposedFact } from "./types";

/**
 * Deterministic note extraction. Used when no AI provider is configured, when the provider fails,
 * and as a cross-check. Every fact carries the exact sentence it came from. Nothing here confirms
 * anything — the output is a proposal for the agent to review (INT02).
 */

type Period = "weekly" | "fortnightly" | "monthly" | "annual";

const AMOUNT = String.raw`\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mil|million|thousand|grand)?\b`;

export function periodIn(text: string): Period | null {
  const t = text.toLowerCase();
  if (/\b(per|a|each|every|\/)\s*(week|wk)\b|\bweekly\b|\bp\.?w\.?\b|\bpw\b/.test(t)) return "weekly";
  if (/\b(per|a|each|every|\/)\s*fortnight\b|\bfortnightly\b|\bpf\b/.test(t)) return "fortnightly";
  if (/\b(per|a|each|every|\/)\s*(month|mth|mo)\b|\bmonthly\b|\bpcm\b|\bp\.?m\.?\b/.test(t)) return "monthly";
  if (/\b(per|a|each|every|\/)\s*(year|yr|annum)\b|\bannual(ly)?\b|\bp\.?a\.?\b|\bpa\b|\bsalary\b/.test(t)) return "annual";
  return null;
}

function amountAfter(sentence: string, keyword: RegExp): { cents: number; raw: string } | null {
  const re = new RegExp(`${keyword.source}[^.;$\\d]{0,40}(${AMOUNT})`, "i");
  const m = sentence.match(re);
  if (!m) return null;
  const cents = parseMoneyToCents(m[m.length - 1]);
  return cents == null ? null : { cents, raw: m[m.length - 1] };
}

function amountBefore(sentence: string, keyword: RegExp): { cents: number; raw: string } | null {
  const re = new RegExp(`(${AMOUNT})[^.;$\\d]{0,25}${keyword.source}`, "i");
  const m = sentence.match(re);
  if (!m) return null;
  const cents = parseMoneyToCents(m[1]);
  return cents == null ? null : { cents, raw: m[1] };
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

const COMMON_WORDS = new Set([
  "I", "We", "The", "They", "He", "She", "It", "Our", "My", "Their", "Looking", "Buyer", "Client", "Notes", "And", "But",
  "Would", "Want", "Wants", "Prefer", "Ideally", "Maybe", "Also", "Budget", "House", "Unit", "Townhouse", "Monday",
  "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March", "April", "May",
  "June", "July", "August", "September", "October", "November", "December", "PPOR", "LVR", "LMI", "AUD",
]);

export function extractWithRules(text: string): { facts: ProposedFact[]; clarifications: Clarification[] } {
  const facts: ProposedFact[] = [];
  const clarifications: Clarification[] = [];
  const push = (path: string, value: ProposedFact["value"], evidenceText: string, confidence: ProposedFact["confidence"] = "medium") =>
    facts.push({ path, valueState: "value", value, evidenceText, confidence });

  for (const s of splitSentences(text)) {
    const lower = s.toLowerCase();

    // Sentences describing what the buyer already owns ("their family home in Carindale") are not
    // about the purchase: they must not set the purchase purpose or the areas to buy in.
    const aboutExisting = /\b(own|owns|owned|currently (live|living|rent)|existing|we live in|they live in)\b/i.test(s);

    // Purpose
    if (/\b(investment property|investor|rental property|rent it out|as an investment|to invest|negative gear)/.test(lower))
      push("goals.purchasePurpose", "investment", s, "high");
    else if (!aboutExisting && /\b(live in|to live|our home|family home|first home|owner[- ]occupier|ppor|move in|upsize|downsize)\b/.test(lower))
      push("goals.purchasePurpose", "ppor", s, "medium");
    if (/\b(not sure|undecided|either).{0,30}(invest|live)/.test(lower)) push("goals.purchasePurpose", "undecided", s, "medium");

    // Income
    const inc = amountAfter(s, /\b(earn|earns|earning|income|salary|make|makes|paid|take home|take-home|wage)\b/i) ?? amountBefore(s, /\b(income|salary|a year|per year)\b/i);
    if (inc && /\b(earn|income|salary|make|paid|take.?home|wage)/i.test(s)) {
      push("household.income.amount", inc.cents, s, "medium");
      const period = periodIn(s);
      if (period) push("household.income.frequency", period, s, "high");
      else
        clarifications.push({
          path: "household.income.frequency",
          question: `"${inc.raw.trim()}" income — is that per week, fortnight, month or year?`,
          evidenceText: s,
        });
      if (/\b(after tax|net|take.?home|in hand)\b/i.test(s)) push("household.income.basis", "net", s, "high");
      else if (/\b(before tax|gross|package|salary)\b/i.test(s)) push("household.income.basis", "gross", s, "medium");
      else clarifications.push({ path: "household.income.basis", question: `Is the ${inc.raw.trim()} income before tax (gross) or after tax (net)?`, evidenceText: s });
    }

    // Expenses
    const exp = amountAfter(s, /\b(expenses|spend|spending|living costs|outgoings|cost of living)\b/i) ?? amountBefore(s, /\b(expenses|in expenses|living costs)\b/i);
    if (exp) {
      push("household.expenses.amount", exp.cents, s, "medium");
      const period = periodIn(s);
      if (period) push("household.expenses.frequency", period, s, "high");
      else clarifications.push({ path: "household.expenses.frequency", question: `Expenses of ${exp.raw.trim()} — over what period?`, evidenceText: s });
    }

    // Cash and offset
    const cash = amountAfter(s, /\b(savings|saved|cash|in the bank|deposit saved|have)\b/i) ?? amountBefore(s, /\b(in savings|saved|in cash|cash|in the bank)\b/i);
    if (cash && /\b(sav|cash|bank)/i.test(s) && !/\b(offset)\b/i.test(s)) push("funds.cash", cash.cents, s, "medium");
    const offset = amountAfter(s, /\boffset\b/i) ?? amountBefore(s, /\b(in (the |an |their )?offset)\b/i);
    if (offset) push("funds.offset", offset.cents, s, "medium");

    // Reserve / buffer
    const reserve = amountAfter(s, /\b(buffer|reserve|keep aside|emergency fund|keep at least)\b/i) ?? amountBefore(s, /\b(buffer|as a buffer|reserve|emergency)\b/i);
    if (reserve) push("funds.protectedReserve", reserve.cents, s, "medium");

    // Equity — ambiguous by nature (INT03): "200k equity" could be total or usable equity.
    // Only an amount described as equity ("400k equity", "equity of $300k") — not "including an equity release".
    const eqm =
      s.match(new RegExp(`(${AMOUNT})\\s+(?:of\\s+)?(?:usable\\s+|available\\s+)?equity\\b(?!\\s+(?:release|draw|loan))`, "i")) ??
      s.match(new RegExp(`\\bequity\\s+of\\s+(?:about\\s+|around\\s+)?(${AMOUNT})`, "i"));
    const eq = eqm ? { raw: eqm[1] } : null;
    if (eq)
      clarifications.push({
        path: null,
        question: `"${eq.raw.trim()} equity" — is that the property value minus the loan, or the amount a lender would let you borrow against it? We need the property value and loan balance separately.`,
        evidenceText: s,
      });

    // Existing property value and debt
    if (/\b(worth|valued|value of|appraised)\b/i.test(s) && /\b(house|home|property|unit|apartment|place|townhouse|ppor|investment)\b/i.test(s)) {
      const v = amountAfter(s, /\b(worth|valued at|value of|appraised at|valued)\b/i);
      if (v) push("properties.1.value", v.cents, s, "medium");
    }
    // Consumer debts (car loans, credit cards) are household commitments, never the property mortgage.
    const consumerDebt = /\b(car|personal|student|hecs|store)\b.{0,15}\b(loan|debt|card|repayments?)\b|\bcredit card\b|\bbuy now\b/i.test(s);
    if (consumerDebt) {
      const limit = s.match(new RegExp(`(${AMOUNT})\\s*(?:credit\\s*)?limit`, "i")) ?? s.match(new RegExp(`limit\\s*(?:of\\s*)?(${AMOUNT})`, "i"));
      if (limit && /\bcredit\b/i.test(s)) {
        const c = parseMoneyToCents(limit[1]);
        if (c != null) push("household.creditLimits", c, s, "medium");
      }
      const repayment = amountAfter(s, /\b(car loan|personal loan|student loan|repayments?|loan)\b/i);
      const period = periodIn(s);
      if (repayment && (period === "monthly" || period === "weekly" || period === "fortnightly")) {
        const monthly = period === "monthly" ? repayment.cents : period === "weekly" ? Math.round((repayment.cents * 52) / 12) : Math.round((repayment.cents * 26) / 12);
        push("household.otherCommitmentsMonthly", monthly, s, "medium");
      }
    }
    const debt = consumerDebt ? null : amountAfter(s, /\b(owe|owing|mortgage of|loan of|debt of|outstanding|left on the loan|mortgage is|loan is|loan balance)\b/i) ?? amountBefore(s, /\b(mortgage|owing|left on|loan balance|outstanding)\b/i);
    if (debt) push("properties.1.debt", debt.cents, s, "medium");

    // Number of properties
    const own = lower.match(/\b(own|have|got)\s+(\d+|one|two|three|four|five)\s+(investment\s+)?(properties|property|houses|units)\b/);
    if (own) push("portfolio.propertyCount", parseNumberToken(own[2]), s, "high");
    else if (/\b(first home|first property|don't own|do not own|never owned|renting at the moment|currently renting)\b/.test(lower))
      push("portfolio.propertyCount", 0, s, "medium");

    // Borrowing limit
    const lim = amountAfter(s, /\b(pre-?approv\w*|borrowing (capacity|power|limit)|can borrow|able to borrow|borrow up to|broker (says|said))\b/i);
    if (lim) {
      push("finance.borrowingLimit", lim.cents, s, "medium");
      if (/pre-?approv/i.test(s)) push("finance.confirmationStatus", "pre_approval", s, "medium");
      else if (/broker/i.test(s)) push("finance.confirmationStatus", "broker_estimate", s, "medium");
    }

    // Budget
    const budget = amountAfter(s, /\b(budget|spend up to|up to|max(imum)?|no more than|around)\b/i);
    if (budget && /\b(budget|spend|max|no more than|price range)\b/i.test(s)) push("preferences.budgetMax", budget.cents, s, "medium");

    // Rent
    const rent = amountAfter(s, /\b(rent|rents|rented|rental)\b/i);
    if (rent && /\b(rent)/i.test(s)) {
      const period = periodIn(s);
      let weekly = rent.cents;
      if (period === "monthly") weekly = Math.round((rent.cents * 12) / 52);
      if (period === "annual") weekly = Math.round(rent.cents / 52);
      if (/\b(currently|is rented|rented out|tenant|tenanted|gets)\b/i.test(s)) push("properties.1.rentWeekly", weekly, s, "medium");
      else push("scenario.expectedWeeklyRent", weekly, s, period ? "medium" : "low");
    }

    // Interest rate
    const rate = s.match(/(\d+(?:\.\d+)?)\s*%\s*(interest|rate|p\.?a\.?)/i) ?? s.match(/(interest|rate)\s*(of|at|is)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (rate) {
      const ratePct = Number(rate[1].match(/\d/) ? rate[1] : rate[3]);
      // The rate on an existing mortgage is that loan's rate, not the assumption for the new loan.
      if (/\b(current|existing)\b.{0,25}\b(loan|mortgage)\b|\bmortgage\b/i.test(s)) push("properties.1.loanRatePct", ratePct, s, "medium");
      else push("finance.interestRatePct", ratePct, s, "medium");
    }

    // Property type and bedrooms
    const type = lower.match(/\b(house|townhouse|unit|apartment)\b/);
    if (type && /\b(want|looking|after|prefer|need|buy|ideally)\b/.test(lower))
      push("preferences.propertyType", type[1] === "apartment" ? "unit" : type[1], s, "medium");
    const beds = lower.match(/\b(\d|one|two|three|four|five)\s*(?:-|\s)?(bed|bedroom|br|bdr)/);
    if (beds) push("preferences.bedroomsMin", parseNumberToken(beds[1]), s, "high");

    // Dependants
    const kids = lower.match(/\b(\d|one|two|three|four|five)\s+(kids|children|dependants|dependents)\b/);
    if (kids) push("household.dependants", parseNumberToken(kids[1]), s, "high");
    else if (/\b(no kids|no children|no dependants)\b/.test(lower)) push("household.dependants", 0, s, "high");

    // Holding period
    const hold = lower.match(/\bhold\w*\s+(?:it\s+)?(?:for\s+)?(?:at least\s+)?(\d+|five|ten|seven|three)\s*(?:\+\s*)?years?/);
    if (hold) push("goals.holdingPeriodYears", parseNumberToken(hold[1]), s, "high");

    // Growth vs income
    if (/\b(capital growth|growth focus|for growth)\b/.test(lower)) push("goals.incomeVsGrowth", "growth", s, "medium");
    else if (/\b(cash ?flow positive|high yield|rental income|for income)\b/.test(lower)) push("goals.incomeVsGrowth", "income", s, "medium");

    // Timing
    const within = lower.match(/\bwithin\s+(\d+|three|six|twelve)\s+months\b/);
    if (within) {
      const m = parseNumberToken(within[1]) ?? 12;
      push("goals.timing", m <= 3 ? "0-3m" : m <= 6 ? "3-6m" : m <= 12 ? "6-12m" : "12m+", s, "medium");
    }

    // Areas: capitalised names after location cues.
    const avoid = s.match(
      /\b(?:avoid|avoiding|steer clear of|not interested in|rule out|ruling out|exclude|excluding)\s+((?:[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)(?:\s*(?:,|and|or)\s*[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)*)/,
    );
    if (avoid) {
      const names = avoid[1]
        .split(/\s*(?:,|\band\b|\bor\b)\s*/)
        .map((n) => n.trim())
        .filter((n) => n && !COMMON_WORDS.has(n.split(" ")[0]));
      if (names.length) push("preferences.excludedAreas", names, s, "medium");
    }
    const areaCue = avoid || aboutExisting ? null : s.match(/\b(?:in|around|near|suburbs? (?:like|such as)|areas? (?:like|such as)|looking at)\s+((?:[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)(?:\s*(?:,|and|or)\s*[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)*)/);
    if (areaCue) {
      const names = areaCue[1]
        .split(/\s*(?:,|\band\b|\bor\b)\s*/)
        .map((n) => n.trim())
        .filter((n) => n && !COMMON_WORDS.has(n.split(" ")[0]));
      if (names.length) {
        if (/\b(avoid|not|exclude|don't want|no)\b/i.test(s)) push("preferences.excludedAreas", names, s, "medium");
        else push("preferences.areas", names, s, "medium");
      }
    }
  }

  // De-duplicate identical facts from the same sentence.
  const seen = new Set<string>();
  const unique = facts.filter((f) => {
    const k = `${f.path}|${JSON.stringify(f.value)}|${f.evidenceText}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Drop "missing period" clarifications when another sentence supplied the period.
  const resolved = clarifications.filter((c) => !c.path || !unique.some((f) => f.path === c.path));
  return { facts: unique, clarifications: resolved };
}
