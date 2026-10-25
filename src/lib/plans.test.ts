import { describe, expect, it } from "vitest";
import { annualPrice, annualSavings, comparison, effectiveMonthly, plans } from "@/lib/plans";

describe("plan pricing", () => {
  it("matches the proposal's monthly prices", () => {
    expect(plans.map((p) => [p.name, p.priceMonthly])).toEqual([
      ["Starter", 2999],
      ["Growth", 7999],
      ["Premier", 19999],
    ]);
  });

  it("charges 10 months for a 12 month year", () => {
    expect(annualPrice(2999)).toBe(29990);
    expect(annualPrice(7999)).toBe(79990);
    expect(annualPrice(19999)).toBe(199990);
  });

  it("saves exactly two months a year", () => {
    for (const plan of plans) {
      expect(annualSavings(plan.priceMonthly)).toBe(plan.priceMonthly * 2);
    }
  });

  it("works out the effective monthly price", () => {
    expect(effectiveMonthly(2999)).toBe(2499);
    expect(effectiveMonthly(7999)).toBe(6666);
  });

  it("highlights exactly one plan", () => {
    expect(plans.filter((p) => p.highlighted)).toHaveLength(1);
  });

  it("gives every comparison row a value for each of the three plans", () => {
    for (const row of comparison) expect(row.values).toHaveLength(3);
  });
});
