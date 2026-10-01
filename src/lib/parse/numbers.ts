const WORDS: Record<string, number> = {
  zero: 0, half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/** Parse "two", "2", "2.5", "1,250" into a number. */
export function parseNumberToken(token: string): number | null {
  const t = token.trim().toLowerCase().replace(/,/g, "");
  if (t in WORDS) return WORDS[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const MONEY_RE = /(-?\$?\s?\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million|thousand|grand)?\b/i;

/**
 * Parse a money expression to cents: "$750,000", "750k", "1.2m", "8 grand".
 * Returns null when no amount is present.
 */
export function parseMoneyToCents(text: string): number | null {
  const m = text.match(MONEY_RE);
  if (!m) return null;
  const base = Number(m[1].replace(/[$,\s]/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const mult = suffix === "k" || suffix === "thousand" || suffix === "grand" ? 1_000 : suffix.startsWith("m") ? 1_000_000 : 1;
  return Math.round(base * mult * 100);
}

export const formatAUD = (cents: number | null | undefined, opts: { cents?: boolean } = {}) => {
  if (cents == null) return "—";
  const v = cents / 100;
  return v.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
};
