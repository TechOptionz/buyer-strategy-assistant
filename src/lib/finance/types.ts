/**
 * Financial calculation contract (spec Section 9).
 *
 * Conventions:
 * - All money is integer cents (number). `null` means UNKNOWN. Unknown is never zero.
 * - Rates are nominal annual percentages (6.5 means 6.5%).
 * - These are scenario conventions, not lender underwriting rules.
 */

export const CALCULATION_VERSION = "1.0.0";

export type Cents = number;

export type RepaymentType = "interest_only" | "principal_and_interest";

export interface RateChange {
  /** 1-based month number from which the new rate applies. */
  fromMonth: number;
  ratePct: number;
}

export interface LoanInput {
  principalCents: Cents | null;
  ratePct: number | null;
  termMonths: number | null;
  repayment: RepaymentType | null;
  /** Interest-only period in months; for `interest_only` with no value, IO runs for the full term. */
  interestOnlyMonths?: number | null;
  rateChanges?: RateChange[];
}

export interface EquityDrawInput extends LoanInput {
  /** Portion of the drawn amount allocated to settlement. Unused proceeds remain traceable cash. */
  allocatedCents: Cents | null;
  /** Whether the security/ownership arrangement supporting the draw is resolved (rule 3). */
  securityArrangementResolved?: boolean;
}

export type FundingSourceKind = "cash" | "offset" | "sale_proceeds" | "super" | "loan_proceeds" | "other";

export interface FundingSource {
  id: string;
  label: string;
  kind: FundingSourceKind;
  amountCents: Cents | null;
  /** The single asset or loan this source draws from. Two sources may not share one. */
  linkedTo?: string | null;
  /** For sale proceeds: net of debt and selling costs, and available before settlement? */
  availableBeforeSettlement?: boolean | null;
  netOfDebtAndCosts?: boolean | null;
}

export interface CostItem {
  label: string;
  amountCents: Cents | null;
  basis?: "quoted" | "manual" | "assumed";
  /** When set, the amount is this percentage of purchase price (used by the funding ceiling search). */
  pctOfPrice?: number | null;
}

export interface ExistingSecurity {
  propertyValueCents: Cents | null;
  securedDebtCents: Cents | null;
  assumedLvrCapPct: number | null;
}

export type BorrowingLimitScope = "includes_equity_draw" | "purchase_loan_only" | "unknown";

export interface BorrowingLimit {
  amountCents: Cents | null;
  scope: BorrowingLimitScope;
  confirmed: boolean;
}

export interface RentInput {
  weeklyCents: Cents | null;
  /** Use exactly one of vacantWeeks or vacancyPct. */
  vacantWeeks?: number | null;
  vacancyPct?: number | null;
}

export interface ScenarioInputs {
  purpose: "investment" | "ppor" | null;
  purchasePriceCents: Cents | null;
  lenderValuationCents: Cents | null;
  purchaseCosts: CostItem[];
  purchaseLoan: LoanInput;
  /** Maximum LVR on the new property (optional test). */
  purchaseLvrCapPct?: number | null;
  equityDraw: EquityDrawInput | null;
  fundingSources: FundingSource[];
  protectedReserveCents: Cents | null;
  otherEarmarkedCents: Cents | null;
  existingSecurity: ExistingSecurity | null;
  borrowingLimit: BorrowingLimit | null;
  rent: RentInput | null;
  operatingCosts: CostItem[] | null;
  /** PPOR only: model a rental component explicitly. */
  modelRentalComponent?: boolean;
  financeConfirmed: boolean;
}

export type SectionStatus = "complete" | "incomplete" | "not_applicable" | "invalid";

export interface Check {
  key: string;
  label: string;
  outcome: "pass" | "fail" | "unresolved" | "warning";
  detail: string;
}

export interface FundingResult {
  status: SectionStatus;
  missing: string[];
  errors: string[];
  currentEquityCents: Cents | null;
  theoreticalHeadroomCents: Cents | null;
  committedCashCents: Cents | null;
  usableCashCents: Cents | null;
  eligibleSaleProceedsCents: Cents | null;
  equityDrawAllocatedCents: Cents | null;
  equityDrawUnallocatedCents: Cents | null;
  availableFundingCents: Cents | null;
  upfrontCostsCents: Cents | null;
  cashRequiredCents: Cents | null;
  fundingSurplusCents: Cents | null;
  cashRemainingIncludingReserveCents: Cents | null;
  newPropertyLvrPct: string | null;
  incrementalBorrowingCents: Cents | null;
  conditionalFunding: boolean;
  excludedSources: { id: string; reason: string }[];
}

export interface CashflowResult {
  status: SectionStatus;
  missing: string[];
  scheduledAnnualRentCents: Cents | null;
  collectedAnnualRentCents: Cents | null;
  annualOperatingCostsCents: Cents | null;
  netOperatingIncomeCents: Cents | null;
  grossRentalYieldPct: string | null;
  netRentalYieldPct: string | null;
  purchaseLoanAnnualDebtServiceCents: Cents | null;
  equityDrawAnnualDebtServiceCents: Cents | null;
  annualIncrementalDebtServiceCents: Cents | null;
  annualIncrementalCashflowCents: Cents | null;
  averageMonthlyCashflowCents: Cents | null;
  /** PPOR: annual repayments plus ownership costs. */
  annualOwnershipCostCents: Cents | null;
}

export interface ScenarioResult {
  calculationVersion: string;
  funding: FundingResult;
  cashflow: CashflowResult;
  checks: Check[];
  financeConfirmed: boolean;
  notes: string[];
}
