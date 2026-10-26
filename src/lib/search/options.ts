import { formatRupeesCompact } from "@/lib/format";

/** The budget choices in the filter form. A value from an old link that is not here is still kept. */
export const BUDGET_STEPS = [
  1_000_000, 2_500_000, 5_000_000, 7_500_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
];

export const SIZE_STEPS = [500, 1000, 1500, 2000, 3000, 5000];

export function budgetLabel(value: number): string {
  return value === 0 ? "₹0" : formatRupeesCompact(value);
}

export function sizeLabel(value: number): string {
  return `${value.toLocaleString("en-IN")} sq ft`;
}

/** The steps, plus the current value if it is not one of them, in order. */
export function withCurrent(steps: number[], current: number | null): number[] {
  return current !== null && !steps.includes(current)
    ? [...steps, current].sort((a, b) => a - b)
    : steps;
}
