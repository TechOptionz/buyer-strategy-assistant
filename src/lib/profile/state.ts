import { fieldDef, labelFor, patternOf } from "./fields";

export type ValueState = "value" | "unknown" | "not_applicable" | "declined";

export interface FactLike {
  id: string;
  fieldPath: string;
  valueState: ValueState;
  value: unknown;
  status: "proposed" | "confirmed" | "rejected" | "superseded";
  sourceType: string;
  sourceId: string | null;
  evidenceText: string | null;
  confirmedById: string | null;
  confirmedAt: string | Date | null;
  createdAt: string | Date;
  proposedBy: string;
  confidence?: string | null;
}

export interface ResolvedField {
  path: string;
  state: ValueState;
  value: unknown;
  factId: string;
  sourceType: string;
  evidenceText: string | null;
  confirmedById: string | null;
  confirmedAt: string | Date | null;
}

export interface ProfileState {
  /** Confirmed, unambiguous values only. */
  confirmed: Record<string, ResolvedField>;
  /** Paths where more than one confirmed value is live. Unusable until a person resolves it. */
  conflicts: Record<string, FactLike[]>;
  /** Proposed (unconfirmed) facts awaiting review. */
  proposed: FactLike[];
}

export const sameValue = (a: FactLike, b: FactLike) =>
  a.valueState === b.valueState && JSON.stringify(a.value) === JSON.stringify(b.value);

export function deriveProfile(facts: FactLike[]): ProfileState {
  const confirmed: Record<string, ResolvedField> = {};
  const conflicts: Record<string, FactLike[]> = {};
  const byPath = new Map<string, FactLike[]>();
  for (const fact of facts) {
    if (fact.status === "confirmed") {
      const list = byPath.get(fact.fieldPath) ?? [];
      list.push(fact);
      byPath.set(fact.fieldPath, list);
    }
  }
  for (const [path, list] of byPath) {
    const distinct: FactLike[] = [];
    for (const f of list) if (!distinct.some((d) => sameValue(d, f))) distinct.push(f);
    if (distinct.length > 1) {
      conflicts[path] = distinct;
      continue;
    }
    const f = list.sort((a, b) => +new Date(b.confirmedAt ?? b.createdAt) - +new Date(a.confirmedAt ?? a.createdAt))[0];
    confirmed[path] = {
      path,
      state: f.valueState,
      value: f.value,
      factId: f.id,
      sourceType: f.sourceType,
      evidenceText: f.evidenceText,
      confirmedById: f.confirmedById,
      confirmedAt: f.confirmedAt,
    };
  }
  const proposed = facts.filter((f) => f.status === "proposed");
  return { confirmed, conflicts, proposed };
}

/** Value accessors used by rules and calculations. Unknown/declined/conflicted all read as undefined. */
export class ProfileView {
  constructor(public readonly state: ProfileState) {}

  has(path: string): boolean {
    return path in this.state.confirmed;
  }
  /** Answered in any way (including "unknown" / "not applicable" / "declined"). */
  answered(path: string): boolean {
    return path in this.state.confirmed;
  }
  /** Has a usable concrete value. */
  known(path: string): boolean {
    const r = this.state.confirmed[path];
    return !!r && r.state === "value";
  }
  get<T = unknown>(path: string): T | undefined {
    const r = this.state.confirmed[path];
    return r && r.state === "value" ? (r.value as T) : undefined;
  }
  inConflict(path: string): boolean {
    return path in this.state.conflicts;
  }
  propertyIndexes(): number[] {
    const set = new Set<number>();
    const count = this.get<number>("portfolio.propertyCount");
    if (count) for (let i = 1; i <= Math.min(count, 10); i++) set.add(i);
    for (const p of [...Object.keys(this.state.confirmed), ...this.state.proposed.map((f) => f.fieldPath)]) {
      const m = p.match(/^properties\.(\d+)\./);
      if (m) set.add(Number(m[1]));
    }
    return [...set].sort((a, b) => a - b);
  }
}

/** Snapshot of the confirmed profile used for profile revisions and scenario reproduction. */
export function profileSnapshot(state: ProfileState) {
  return {
    confirmed: Object.fromEntries(Object.entries(state.confirmed).map(([k, v]) => [k, { state: v.state, value: v.value, factId: v.factId }])),
    conflicts: Object.keys(state.conflicts),
  };
}

export function describeConflict(path: string) {
  return `Conflicting confirmed values for ${labelFor(path)}`;
}

export function isMaterial(path: string) {
  return fieldDef(path)?.material ?? false;
}

export { patternOf };
