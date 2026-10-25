import { describe, expect, it } from "vitest";
import { formatRupees, formatRupeesCompact } from "@/lib/format";

describe("formatRupees", () => {
  it("uses Indian digit grouping", () => {
    expect(formatRupees(2999)).toBe("₹2,999");
    expect(formatRupees(29990)).toBe("₹29,990");
    expect(formatRupees(1234567)).toBe("₹12,34,567");
  });

  it("rounds to whole rupees", () => {
    expect(formatRupees(2499.17)).toBe("₹2,499");
  });
});

describe("formatRupeesCompact", () => {
  it("shows lakhs and crores", () => {
    expect(formatRupeesCompact(4500000)).toBe("₹45 L");
    expect(formatRupeesCompact(125000)).toBe("₹1.25 L");
    expect(formatRupeesCompact(12000000)).toBe("₹1.2 Cr");
    expect(formatRupeesCompact(25000000)).toBe("₹2.5 Cr");
  });

  it("falls back to exact rupees below a lakh", () => {
    expect(formatRupeesCompact(99000)).toBe("₹99,000");
  });
});
