import type { ProfileView } from "../profile/state";

/**
 * Safe, typed predicate language for question eligibility and readiness. Predicates are plain data
 * evaluated by this module; nothing from AI output or user content is ever executed as code.
 */
export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: string; op: "eq" | "neq"; value: string | number | boolean }
  | { field: string; op: "in"; value: (string | number | boolean)[] }
  | { field: string; op: "gt"; value: number }
  | { field: string; op: "known" | "answered" | "unanswered" | "truthy" }
  | { fn: RegisteredFn };

export type RegisteredFn = "investmentPath" | "pporPath" | "hasExistingProperties" | "equityDrawPlanned" | "sellingAProperty";

const FNS: Record<RegisteredFn, (v: ProfileView) => boolean> = {
  investmentPath: (v) => ["investment", "undecided"].includes(v.get<string>("goals.purchasePurpose") ?? ""),
  pporPath: (v) => ["ppor", "undecided"].includes(v.get<string>("goals.purchasePurpose") ?? ""),
  hasExistingProperties: (v) => (v.get<number>("portfolio.propertyCount") ?? 0) > 0,
  equityDrawPlanned: (v) => v.get<boolean>("funding.equityDrawRequested") === true,
  sellingAProperty: (v) => v.propertyIndexes().some((i) => v.get(`properties.${i}.intention`) === "sell"),
};

export function evaluate(p: Predicate, v: ProfileView): boolean {
  if ("all" in p) return p.all.every((q) => evaluate(q, v));
  if ("any" in p) return p.any.some((q) => evaluate(q, v));
  if ("not" in p) return !evaluate(p.not, v);
  if ("fn" in p) return FNS[p.fn]?.(v) ?? false;
  const val = v.get(p.field);
  switch (p.op) {
    case "eq":
      return val === p.value;
    case "neq":
      return val !== p.value;
    case "in":
      return p.value.includes(val as string);
    case "gt":
      return typeof val === "number" && val > p.value;
    case "known":
      return v.known(p.field);
    case "answered":
      return v.answered(p.field);
    case "unanswered":
      return !v.answered(p.field);
    case "truthy":
      return !!val;
  }
}
