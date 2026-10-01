import { D, type Dec, toCents } from "./decimal";
import type { LoanInput } from "./types";

export interface ScheduleRow {
  month: number;
  ratePct: number;
  openingCents: number;
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  closingCents: number;
  interestOnly: boolean;
}

export type ScheduleOutcome =
  | { status: "complete"; rows: ScheduleRow[]; totalInterestCents: number; firstYearPaymentsCents: number }
  | { status: "incomplete"; missing: string[] }
  | { status: "invalid"; errors: string[] };

export function loanMissingFields(loan: LoanInput, prefix: string): string[] {
  const missing: string[] = [];
  if (loan.principalCents == null) missing.push(`${prefix}.principalCents`);
  if (loan.ratePct == null) missing.push(`${prefix}.ratePct`);
  if (loan.termMonths == null) missing.push(`${prefix}.termMonths`);
  if (loan.repayment == null) missing.push(`${prefix}.repayment`);
  return missing;
}

export function validateLoan(loan: LoanInput, prefix: string): string[] {
  const errors: string[] = [];
  if (loan.termMonths != null && (!Number.isInteger(loan.termMonths) || loan.termMonths <= 0))
    errors.push(`${prefix}.termMonths must be a positive whole number of months`);
  if (loan.ratePct != null && (!Number.isFinite(loan.ratePct) || loan.ratePct < 0 || loan.ratePct > 100))
    errors.push(`${prefix}.ratePct must be between 0 and 100`);
  if (loan.principalCents != null && loan.principalCents < 0) errors.push(`${prefix}.principalCents cannot be negative`);
  const io = loan.interestOnlyMonths;
  if (io != null && (io < 0 || !Number.isInteger(io) || (loan.termMonths != null && io > loan.termMonths)))
    errors.push(`${prefix}.interestOnlyMonths must be between 0 and the term`);
  for (const rc of loan.rateChanges ?? []) {
    if (!Number.isInteger(rc.fromMonth) || rc.fromMonth < 1) errors.push(`${prefix}.rateChanges fromMonth must be >= 1`);
    if (rc.ratePct < 0 || rc.ratePct > 100) errors.push(`${prefix}.rateChanges ratePct must be between 0 and 100`);
  }
  return errors;
}

/** Equal monthly payment for a fixed-rate P&I loan; r == 0 amortises evenly. */
export function amortisingPayment(principal: Dec, annualRatePct: Dec, months: number): Dec {
  const r = annualRatePct.div(100).div(12);
  if (r.isZero()) return principal.div(months);
  const factor = new D(1).minus(r.plus(1).pow(-months));
  return principal.mul(r).div(factor);
}

/**
 * Monthly scenario schedule (spec 9.4). Interest-only months pay interest only; at expiry the
 * remaining balance amortises over the remaining term. Rate changes apply from declared months and
 * re-amortise the remaining balance over the remaining term. Internal precision is kept in
 * Decimal; displayed values round to cents and the final payment reconciles to a zero balance.
 */
export function buildSchedule(loan: LoanInput, prefix = "loan"): ScheduleOutcome {
  const missing = loanMissingFields(loan, prefix);
  if (missing.length) return { status: "incomplete", missing };
  const errors = validateLoan(loan, prefix);
  if (errors.length) return { status: "invalid", errors };

  const term = loan.termMonths!;
  const ioMonths =
    loan.repayment === "interest_only" ? (loan.interestOnlyMonths ?? term) : (loan.interestOnlyMonths ?? 0);
  const changes = [...(loan.rateChanges ?? [])].sort((a, b) => a.fromMonth - b.fromMonth);

  let balance = new D(loan.principalCents!);
  let rate = new D(loan.ratePct!);
  let payment: Dec | null = null;
  const rows: ScheduleRow[] = [];
  let totalInterest = new D(0);
  let firstYear = new D(0);

  for (let month = 1; month <= term; month++) {
    const change = changes.find((c) => c.fromMonth === month);
    if (change) {
      rate = new D(change.ratePct);
      payment = null; // re-amortise from this month
    }
    const r = rate.div(100).div(12);
    const opening = balance;
    const interest = opening.mul(r);
    const interestOnly = month <= ioMonths;
    let pay: Dec;
    let principalPaid: Dec;
    if (interestOnly) {
      pay = interest;
      principalPaid = new D(0);
    } else {
      if (payment === null) payment = amortisingPayment(opening, rate, term - month + 1);
      pay = payment;
      principalPaid = pay.minus(interest);
      if (month === term) {
        // Reconcile the final payment so the closing balance is exactly zero.
        principalPaid = opening;
        pay = opening.plus(interest);
      }
    }
    balance = opening.minus(principalPaid);
    totalInterest = totalInterest.plus(interest);
    if (month <= 12) firstYear = firstYear.plus(pay);
    rows.push({
      month,
      ratePct: rate.toNumber(),
      openingCents: toCents(opening),
      paymentCents: toCents(pay),
      interestCents: toCents(interest),
      principalCents: toCents(principalPaid),
      closingCents: toCents(balance),
      interestOnly,
    });
  }
  return {
    status: "complete",
    rows,
    totalInterestCents: toCents(totalInterest),
    firstYearPaymentsCents: toCents(firstYear),
  };
}

