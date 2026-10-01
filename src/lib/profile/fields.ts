/**
 * Buyer data registry (spec Section 6). Every profile value is addressed by a field path.
 * Collections use an index segment: `properties.1.value`. Registry entries use `*` for the index.
 */

export type FieldType =
  | "money" // integer cents
  | "number"
  | "percent"
  | "text"
  | "enum"
  | "boolean"
  | "list" // string[]
  | "date"; // ISO date

export type Topic =
  | "case"
  | "goals"
  | "household"
  | "properties"
  | "funds"
  | "super"
  | "finance"
  | "preferences"
  | "scenario";

export const TOPIC_LABELS: Record<Topic, string> = {
  case: "Identity and case",
  goals: "Objectives",
  household: "Household",
  properties: "Existing properties",
  funds: "Assets and funds",
  super: "Superannuation",
  finance: "Finance",
  preferences: "Property preferences",
  scenario: "Scenario assumptions",
};

export interface FieldDef {
  path: string;
  label: string;
  topic: Topic;
  type: FieldType;
  options?: { value: string; label: string }[];
  /** Material fields need explicit human confirmation before use (INT02, INT05). */
  material: boolean;
  help?: string;
}

const PERIODS = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

const f = (path: string, label: string, topic: Topic, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  topic,
  type,
  material: type === "money" || type === "percent",
  ...extra,
});

export const FIELDS: FieldDef[] = [
  // Identity and case
  f("case.householdParticipants", "Household participants", "case", "text"),
  f("case.reportAudience", "Report audience", "case", "enum", {
    options: [
      { value: "buyer", label: "Buyer" },
      { value: "internal", label: "Internal only" },
      { value: "broker", label: "Buyer and their broker" },
    ],
  }),
  f("case.consentRecorded", "Consent to collect and use information recorded", "case", "boolean", { material: true }),

  // Objectives
  f("goals.purchasePurpose", "Purchase purpose", "goals", "enum", {
    material: true,
    options: [
      { value: "ppor", label: "Home to live in (PPOR)" },
      { value: "investment", label: "Investment" },
      { value: "undecided", label: "Undecided — compare both" },
    ],
  }),
  f("goals.reason", "Reason for purchase", "goals", "text"),
  f("goals.timing", "Purchase timing", "goals", "enum", {
    options: [
      { value: "0-3m", label: "Within 3 months" },
      { value: "3-6m", label: "3–6 months" },
      { value: "6-12m", label: "6–12 months" },
      { value: "12m+", label: "More than 12 months" },
    ],
  }),
  f("goals.holdingPeriodYears", "Intended holding period (years)", "goals", "number"),
  f("goals.incomeVsGrowth", "Income versus growth priority", "goals", "enum", {
    options: [
      { value: "income", label: "Rental income" },
      { value: "balanced", label: "Balanced" },
      { value: "growth", label: "Capital growth" },
    ],
  }),
  f("goals.comfortableMonthlyContribution", "Comfortable monthly contribution / acceptable shortfall", "goals", "money"),
  f("goals.desiredOutcome", "Desired outcome", "goals", "text"),
  f("goals.managementPreference", "Management preference", "goals", "enum", {
    options: [
      { value: "agent_managed", label: "Property manager" },
      { value: "self_managed", label: "Self-managed" },
      { value: "not_sure", label: "Not sure" },
    ],
  }),
  f("goals.householdNeeds", "Household needs (schools, space, access)", "goals", "text"),

  // Household
  f("household.income.amount", "Household income amount", "household", "money"),
  f("household.income.frequency", "Income frequency", "household", "enum", { options: PERIODS, material: true }),
  f("household.income.basis", "Income basis", "household", "enum", {
    material: true,
    options: [
      { value: "gross", label: "Gross (before tax)" },
      { value: "net", label: "Net (after tax)" },
    ],
  }),
  f("household.income.type", "Income type", "household", "text"),
  f("household.employment", "Employment situation", "household", "text"),
  f("household.expenses.amount", "Living expenses amount", "household", "money"),
  f("household.expenses.frequency", "Expenses frequency", "household", "enum", { options: PERIODS, material: true }),
  f("household.dependants", "Dependants", "household", "number", { material: true }),
  f("household.currentLoanRepaymentsMonthly", "Current loan repayments (monthly)", "household", "money"),
  f("household.otherCommitmentsMonthly", "Other commitments (monthly)", "household", "money"),
  f("household.creditLimits", "Credit card and other credit limits", "household", "money"),

  // Existing properties
  f("portfolio.propertyCount", "Number of existing properties", "properties", "number", { material: true }),
  f("properties.*.address", "Address or label", "properties", "text"),
  f("properties.*.type", "Property type", "properties", "enum", {
    options: [
      { value: "house", label: "House" },
      { value: "townhouse", label: "Townhouse" },
      { value: "unit", label: "Unit / apartment" },
      { value: "land", label: "Land" },
    ],
  }),
  f("properties.*.use", "Current use", "properties", "enum", {
    options: [
      { value: "ppor", label: "Home (PPOR)" },
      { value: "investment", label: "Investment" },
    ],
  }),
  f("properties.*.ownershipSharePct", "Ownership share (%)", "properties", "percent"),
  f("properties.*.ownershipStructure", "Ownership structure", "properties", "enum", {
    material: true,
    options: [
      { value: "sole", label: "Sole name" },
      { value: "joint", label: "Joint with partner" },
      { value: "tenants_in_common", label: "Tenants in common / co-owned" },
      { value: "company_trust", label: "Company or trust" },
    ],
  }),
  f("properties.*.value", "Estimated value", "properties", "money"),
  f("properties.*.valueDate", "Value date", "properties", "date"),
  f("properties.*.valueSource", "Value source", "properties", "text"),
  f("properties.*.debt", "Secured debt outstanding", "properties", "money"),
  f("properties.*.loanRatePct", "Loan interest rate", "properties", "percent"),
  f("properties.*.loanRepaymentMonthly", "Loan repayment (monthly)", "properties", "money"),
  f("properties.*.rentWeekly", "Current weekly rent", "properties", "money"),
  f("properties.*.annualCosts", "Annual holding costs", "properties", "money"),
  f("properties.*.intention", "Keep or sell", "properties", "enum", {
    material: true,
    options: [
      { value: "keep", label: "Keep" },
      { value: "sell", label: "Sell" },
      { value: "undecided", label: "Undecided" },
    ],
  }),
  f("properties.*.securityArrangementResolved", "Debt and security arrangements clear for co-owners", "properties", "boolean", { material: true }),

  // Assets and funds
  f("funds.cash", "Cash savings", "funds", "money"),
  f("funds.offset", "Offset balances", "funds", "money"),
  f("funds.investments", "Other investments (shares etc.)", "funds", "money"),
  f("funds.earmarked", "Cash earmarked for other purposes", "funds", "money"),
  f("funds.protectedReserve", "Cash reserve to keep untouched", "funds", "money"),
  f("funds.saleProceedsNet", "Net sale proceeds (after debt and selling costs)", "funds", "money"),
  f("funds.saleProceedsBeforeSettlement", "Sale proceeds available before settlement", "funds", "boolean", { material: true }),

  // Superannuation
  f("super.balance", "Super balance (optional)", "super", "money"),
  f("super.category", "Super category", "super", "text"),

  // Finance
  f("finance.borrowingLimit", "Borrowing limit", "finance", "money"),
  f("finance.limitSource", "Borrowing limit source", "finance", "text"),
  f("finance.limitDate", "Borrowing limit date", "finance", "date"),
  f("finance.limitExpiry", "Borrowing limit expiry", "finance", "date"),
  f("finance.limitScope", "Borrowing limit scope", "finance", "enum", {
    material: true,
    options: [
      { value: "includes_equity_draw", label: "Includes the equity release" },
      { value: "purchase_loan_only", label: "New purchase loan only" },
      { value: "not_sure", label: "Not sure" },
    ],
  }),
  f("finance.confirmationStatus", "Finance confirmation status", "finance", "enum", {
    material: true,
    options: [
      { value: "none", label: "Not started" },
      { value: "broker_estimate", label: "Broker estimate" },
      { value: "pre_approval", label: "Pre-approval" },
      { value: "formal_approval", label: "Formal approval" },
    ],
  }),
  f("funding.equityDrawRequested", "Equity release planned", "finance", "boolean", { material: true }),
  f("finance.equityDrawAmount", "Equity release amount", "finance", "money"),
  f("finance.lvrCapPct", "Assumed LVR cap", "finance", "percent"),
  f("finance.loanTermYears", "Loan term (years)", "finance", "number", { material: true }),
  f("finance.interestRatePct", "Assumed interest rate", "finance", "percent"),
  f("finance.repaymentType", "Repayment type", "finance", "enum", {
    material: true,
    options: [
      { value: "principal_and_interest", label: "Principal and interest" },
      { value: "interest_only", label: "Interest only" },
    ],
  }),

  // Preferences
  f("preferences.areas", "Areas of interest", "preferences", "list"),
  f("preferences.areasMandatory", "Areas are mandatory or flexible", "preferences", "enum", {
    options: [
      { value: "mandatory", label: "Mandatory" },
      { value: "flexible", label: "Flexible" },
    ],
  }),
  f("preferences.excludedAreas", "Excluded areas", "preferences", "list"),
  f("preferences.propertyType", "Preferred property type", "preferences", "enum", {
    options: [
      { value: "house", label: "House" },
      { value: "townhouse", label: "Townhouse" },
      { value: "unit", label: "Unit / apartment" },
      { value: "any", label: "Open to any" },
    ],
  }),
  f("preferences.propertyTypeMandatory", "Property type is essential", "preferences", "boolean"),
  f("preferences.bedroomsMin", "Minimum bedrooms", "preferences", "number"),
  f("preferences.landOrLifestyle", "Land or lifestyle needs", "preferences", "text"),
  f("preferences.commute", "Commute requirement", "preferences", "text"),
  f("preferences.renovationAppetite", "Renovation appetite", "preferences", "enum", {
    options: [
      { value: "none", label: "None — move-in ready" },
      { value: "cosmetic", label: "Cosmetic" },
      { value: "structural", label: "Open to major works" },
    ],
  }),
  f("preferences.budgetMax", "Stated purchase budget", "preferences", "money"),
  f("preferences.budgetFixed", "Budget is fixed", "preferences", "boolean"),

  // Scenario assumptions
  f("scenario.targetPrice", "Target purchase price", "scenario", "money"),
  f("scenario.purchaseCosts", "Purchase costs (duty, legal, inspections, fees)", "scenario", "money"),
  f("scenario.purchaseCostsSource", "Purchase costs source", "scenario", "text"),
  f("scenario.purchaseLoanAmount", "Planned purchase loan", "scenario", "money", {
    help: "Leave unanswered to assume price × LVR cap (labelled as an assumption).",
  }),
  f("scenario.expectedWeeklyRent", "Expected weekly rent", "scenario", "money"),
  f("scenario.vacantWeeks", "Vacant weeks per year", "scenario", "number", { material: true }),
  f("scenario.annualOperatingCosts", "Annual operating costs (management, rates, insurance, maintenance, strata)", "scenario", "money"),
  f("scenario.forecastHorizonYears", "Forecast horizon (years)", "scenario", "number"),
  f("scenario.growthAssumptionPct", "Growth assumption (per year)", "scenario", "percent"),
];

const BY_PATTERN = new Map(FIELDS.map((d) => [d.path, d]));

/** Normalise a concrete path ("properties.2.value") to its registry pattern ("properties.*.value"). */
export function patternOf(path: string): string {
  return path.replace(/\.\d+\./g, ".*.");
}

export function fieldDef(path: string): FieldDef | undefined {
  return BY_PATTERN.get(patternOf(path));
}

export function isValidPath(path: string): boolean {
  if (!fieldDef(path)) return false;
  const m = path.match(/^properties\.(\d+)\./);
  return !m || (Number(m[1]) >= 1 && Number(m[1]) <= 10);
}

export function labelFor(path: string): string {
  const def = fieldDef(path);
  if (!def) return path;
  const m = path.match(/^properties\.(\d+)\./);
  return m ? `Property ${m[1]} — ${def.label}` : def.label;
}

export type FieldValidation = { ok: true; value: unknown } | { ok: false; error: string };

/** Validate and coerce a raw value for a field. Money must already be integer cents. */
export function validateValue(path: string, raw: unknown): FieldValidation {
  const def = fieldDef(path);
  if (!def) return { ok: false, error: `Unknown field ${path}` };
  switch (def.type) {
    case "money": {
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "Amount must be whole cents" };
      if (n < 0 && !path.includes("Cashflow")) return { ok: false, error: "Amount cannot be negative" };
      return { ok: true, value: n };
    }
    case "number":
    case "percent": {
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: "Must be a number" };
      if (n < 0) return { ok: false, error: "Cannot be negative" };
      if (def.type === "percent" && n > 100) return { ok: false, error: "Percentage must be 100 or less" };
      return { ok: true, value: n };
    }
    case "enum": {
      if (typeof raw !== "string" || !def.options?.some((o) => o.value === raw)) return { ok: false, error: "Choose one of the listed options" };
      return { ok: true, value: raw };
    }
    case "boolean":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, error: "Must be yes or no" };
    case "list": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : null;
      if (!arr) return { ok: false, error: "Must be a list" };
      const clean = arr.map((s) => String(s).trim()).filter(Boolean);
      return { ok: true, value: clean };
    }
    case "date":
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: "Use YYYY-MM-DD" };
      return { ok: true, value: raw };
    case "text":
      if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Enter some text" };
      return { ok: true, value: raw.trim().slice(0, 2000) };
  }
}

export function formatValue(path: string, value: unknown): string {
  const def = fieldDef(path);
  if (value == null) return "—";
  if (!def) return String(value);
  switch (def.type) {
    case "money":
      return (Number(value) / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2, minimumFractionDigits: 0 });
    case "percent":
      return `${value}%`;
    case "enum":
      return def.options?.find((o) => o.value === value)?.label ?? String(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "list":
      return (value as string[]).join(", ");
    default:
      return String(value);
  }
}
