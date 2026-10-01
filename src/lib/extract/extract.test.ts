import { describe, expect, it } from "vitest";
import { extractWithRules } from "./rules";
import { validateExtraction } from "./validate";

const run = (text: string) => {
  const r = extractWithRules(text);
  return validateExtraction(text, r.facts, r.clarifications, "rules");
};

describe("AT01 periods and ambiguity", () => {
  it("weekly income and monthly expenses retain their periods", () => {
    const r = run("Sam earns $2,400 per week after tax. Their living expenses are about $4,000 per month.");
    const get = (p: string) => r.proposedFacts.find((f) => f.path === p)?.value;
    expect(get("household.income.amount")).toBe(240_000);
    expect(get("household.income.frequency")).toBe("weekly");
    expect(get("household.income.basis")).toBe("net");
    expect(get("household.expenses.amount")).toBe(400_000);
    expect(get("household.expenses.frequency")).toBe("monthly");
  });

  it('ambiguous "8k income" produces a follow-up', () => {
    const r = run("I earn 8k.");
    expect(r.proposedFacts.find((f) => f.path === "household.income.amount")?.value).toBe(800_000);
    expect(r.proposedFacts.find((f) => f.path === "household.income.frequency")).toBeUndefined();
    expect(r.clarifications.some((c) => c.path === "household.income.frequency")).toBe(true);
  });

  it('"we have 200k equity" is clarified before numeric use', () => {
    const r = run("We have 200k equity in our place.");
    expect(r.proposedFacts.some((f) => f.path.startsWith("properties.1.value"))).toBe(false);
    expect(r.clarifications.some((c) => /equity/.test(c.question))).toBe(true);
  });
});

describe("extraction evidence and conflicts", () => {
  it("every fact quotes text that exists in the source", () => {
    const text = "Looking for an investment property in Ipswich or Logan. Budget up to $650k. 3 bedroom house.";
    const r = run(text);
    expect(r.proposedFacts.length).toBeGreaterThan(3);
    for (const f of r.proposedFacts) expect(text).toContain(f.evidenceText);
    expect(r.proposedFacts.find((f) => f.path === "preferences.areas")?.value).toEqual(["Ipswich", "Logan"]);
  });

  it("contradictory values in one note are preserved as a conflict", () => {
    const r = run("We have $80,000 in savings. Actually the savings are closer to $95,000.");
    const c = r.conflicts.find((x) => x.path === "funds.cash");
    expect(c?.values.map((v) => v.value).sort()).toEqual([8_000_000, 9_500_000]);
  });

  it("rejects AI facts whose evidence is not in the source", () => {
    const r = validateExtraction(
      "We want a house.",
      [{ path: "funds.cash", valueState: "value", value: "50000", evidenceText: "we have 50k cash", confidence: "high" }],
      [],
      "ai",
    );
    expect(r.proposedFacts).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/not found/);
  });

  it("rejects unknown field paths", () => {
    const r = validateExtraction("x", [{ path: "admin.isSuperuser", valueState: "value", value: "true", evidenceText: "x", confidence: "high" }], [], "ai");
    expect(r.rejected[0].reason).toBe("Unknown field");
  });
});

describe("meeting-note sentences that described the wrong thing", () => {
  const facts = (text: string) => run(text).proposedFacts;
  const values = (text: string, path: string) => facts(text).filter((f) => f.path === path).map((f) => f.value);

  it("an existing family home does not set the purchase purpose or the areas to buy in", () => {
    const text = "They own 1 property, their family home in Carindale.";
    expect(values(text, "goals.purchasePurpose")).toEqual([]);
    expect(values(text, "preferences.areas")).toEqual([]);
    expect(values(text, "portfolio.propertyCount")).toEqual([1]);
  });

  it("a car loan is a monthly commitment, not the property mortgage", () => {
    const text = "Other commitments: a car loan of about $650 a month and a credit card with a $10,000 limit.";
    expect(values(text, "properties.1.debt")).toEqual([]);
    expect(values(text, "household.otherCommitmentsMonthly")).toEqual([65_000]);
    expect(values(text, "household.creditLimits")).toEqual([1_000_000]);
  });

  it("areas to avoid are excluded areas", () => {
    const text = "They want to avoid Inala and Logan Central.";
    expect(values(text, "preferences.excludedAreas")).toEqual([["Inala", "Logan Central"]]);
    expect(values(text, "preferences.areas")).toEqual([]);
  });

  it('"including an equity release" is not an equity amount to clarify', () => {
    const r = run("Their broker said they can borrow up to $850,000 including an equity release.");
    expect(r.proposedFacts.find((f) => f.path === "finance.borrowingLimit")?.value).toBe(85_000_000);
    expect(r.clarifications.some((c) => /equity/.test(c.question))).toBe(false);
  });

  it("the current mortgage rate is that loan's rate, not the new-loan assumption", () => {
    const text = "Their current home loan interest rate is 6.2% p.a.";
    expect(values(text, "finance.interestRatePct")).toEqual([]);
    expect(values(text, "properties.1.loanRatePct")).toEqual([6.2]);
  });

  it("a new-loan rate assumption is still recognised", () => {
    expect(values("Assume an interest rate of 6.5% for the new loan.", "finance.interestRatePct")).toEqual([6.5]);
  });
});
