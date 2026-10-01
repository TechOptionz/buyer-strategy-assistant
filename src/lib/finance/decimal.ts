import Decimal from "decimal.js";

// Full internal precision; rounding happens only at the documented boundaries.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** Round a cents-denominated Decimal to an integer number of cents (half up, away from zero for negatives). */
export function toCents(value: Dec): number {
  const rounded = value.abs().toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return (value.isNegative() ? rounded.neg() : rounded).toNumber();
}

/** Percentage string with fixed decimal places, e.g. "4.8750". */
export function pct(value: Dec, places = 4): string {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

export function sumCents(values: number[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), new D(0));
}
