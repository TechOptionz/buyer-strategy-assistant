/**
 * FinancialValue number rules (design system): full values in profiles, abbreviated in comparisons,
 * a true minus sign, a period on every flow, rates to two decimals, cents only where they exist,
 * "—" for missing (never $0), dates as "01 Oct 2026".
 */

export const MINUS = "−";

const TZ = "Australia/Brisbane";

/** $800,000 · −$19,400 · −$1,616.67 (cents only when present or requested). */
export function money(cents: number | null | undefined, opts: { cents?: boolean; signed?: boolean } = {}): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  const abs = Math.abs(cents) / 100;
  const hasCents = opts.cents ?? Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString("en-AU", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 });
  const sign = cents < 0 ? MINUS : opts.signed && cents > 0 ? "+" : "";
  return `${sign}$${body}`;
}

/** Abbreviated for lists and comparisons: $835k · $1.42m · $950. */
export function moneyShort(cents: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  const v = Math.abs(cents) / 100;
  const sign = cents < 0 ? MINUS : opts.signed && cents > 0 ? "+" : "";
  if (v >= 1_000_000) return `${sign}$${trim(v / 1_000_000, 2)}m`;
  if (v >= 10_000) return `${sign}$${trim(v / 1_000, 0)}k`;
  if (v >= 1_000) return `${sign}$${trim(v / 1_000, 1)}k`;
  return `${sign}$${trim(v, 0)}`;
}

function trim(n: number, dp: number) {
  return Number(n.toFixed(dp)).toString();
}

/** 6.50% p.a. */
export function rate(pct: number | string | null | undefined, suffix = "% p.a."): string {
  if (pct == null || pct === "") return "—";
  return `${Number(pct).toFixed(2)}${suffix}`;
}

/** Yields as supplied by the engine: 4.88% */
export function pct(v: number | string | null | undefined, dp = 2): string {
  if (v == null || v === "") return "—";
  return `${Number(v).toFixed(dp)}%`;
}

/** Percentage-point change: +2.00 pts */
export function pts(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? MINUS : ""}${Math.abs(n).toFixed(2)} pts`;
}

/** 01 Oct 2026 */
export function date(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

/** 01 Oct 2026, 10:42 */
export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return String(iso);
  return `${date(d)}, ${d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/** 10:42 */
export function time(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "2 min ago", "1 hr ago", "Yesterday", "3 days ago", then the date. */
export function relative(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const s = Math.max(0, (+now - +d) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172_800) return "Yesterday";
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  return date(d);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const ROLE_LABEL: Record<string, string> = {
  org_admin: "Organisation administrator",
  buyer_agent: "Buyer agent",
  reviewer: "Reviewer",
};

export const SOURCE_LABEL: Record<string, string> = {
  conversation: "Interview",
  notes: "Meeting notes",
  structured_entry: "Manual edit",
  document: "Client-supplied",
  agent_override: "Manual edit",
};
