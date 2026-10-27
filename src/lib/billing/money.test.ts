import { describe, expect, it } from "vitest";
import {
  addInterval,
  computeGst,
  financialYear,
  formatInvoiceNumber,
  formatPaise,
  planSubtotalPaise,
  prorationCreditPaise,
} from "@/lib/billing/money";

describe("planSubtotalPaise", () => {
  it("is the monthly price in paise", () => {
    expect(planSubtotalPaise("STARTER", "MONTHLY")).toBe(299_900);
    expect(planSubtotalPaise("GROWTH", "MONTHLY")).toBe(799_900);
    expect(planSubtotalPaise("PREMIER", "MONTHLY")).toBe(1_999_900);
  });

  it("charges ten months for a year", () => {
    expect(planSubtotalPaise("STARTER", "ANNUAL")).toBe(2_999_000);
    expect(planSubtotalPaise("GROWTH", "ANNUAL")).toBe(7_999_000);
  });
});

describe("computeGst", () => {
  it("splits into CGST and SGST inside the supplier's state", () => {
    expect(
      computeGst({
        subtotalPaise: 799_900,
        supplierState: "Tamil Nadu",
        customerState: "Tamil Nadu",
      }),
    ).toEqual({
      cgstPaise: 71_991,
      sgstPaise: 71_991,
      igstPaise: 0,
      totalPaise: 943_882,
    });
  });

  it("charges IGST to another state", () => {
    expect(
      computeGst({
        subtotalPaise: 799_900,
        supplierState: "Tamil Nadu",
        customerState: "Karnataka",
      }),
    ).toEqual({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 143_982,
      totalPaise: 943_882,
    });
  });

  it("compares states loosely: case, spaces and punctuation do not matter", () => {
    expect(
      computeGst({
        subtotalPaise: 100_000,
        supplierState: "Tamil Nadu",
        customerState: " tamil-nadu ",
      }).igstPaise,
    ).toBe(0);
  });

  it("assumes the supplier's state when the customer's is unknown", () => {
    expect(
      computeGst({ subtotalPaise: 100_000, supplierState: "Tamil Nadu", customerState: null })
        .igstPaise,
    ).toBe(0);
    expect(
      computeGst({ subtotalPaise: 100_000, supplierState: "Tamil Nadu", customerState: "" })
        .igstPaise,
    ).toBe(0);
  });

  it("never loses a paisa: CGST + SGST always equals the tax", () => {
    for (const subtotal of [1, 3, 99, 12_345, 299_901, 7_777_777]) {
      const gst = computeGst({ subtotalPaise: subtotal, supplierState: "A", customerState: "A" });
      const tax = Math.round((subtotal * 18) / 100);
      expect(gst.cgstPaise + gst.sgstPaise).toBe(tax);
      expect(gst.totalPaise).toBe(subtotal + tax);
      expect(gst.sgstPaise - gst.cgstPaise).toBeLessThanOrEqual(1);
    }
  });

  it("is exactly zero tax on a zero amount", () => {
    expect(computeGst({ subtotalPaise: 0, supplierState: "A", customerState: "B" })).toEqual({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise: 0,
    });
  });
});

describe("addInterval", () => {
  const at = (iso: string) => new Date(iso);
  it("adds a calendar month", () => {
    expect(addInterval(at("2026-11-10T06:00:00Z"), "MONTHLY").toISOString()).toBe(
      "2026-12-10T06:00:00.000Z",
    );
    expect(addInterval(at("2026-12-31T00:00:00Z"), "MONTHLY").toISOString()).toBe(
      "2027-01-31T00:00:00.000Z",
    );
  });

  it("does not run past the end of a short month", () => {
    expect(addInterval(at("2026-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addInterval(at("2028-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("adds a calendar year, including from 29 February", () => {
    expect(addInterval(at("2026-11-10T06:00:00Z"), "ANNUAL").toISOString()).toBe(
      "2027-11-10T06:00:00.000Z",
    );
    expect(addInterval(at("2028-02-29T00:00:00Z"), "ANNUAL").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });
});

describe("addInterval with a count", () => {
  it("counts from the start, not period by period", () => {
    const start = new Date("2026-01-31T00:00:00Z");
    expect(addInterval(start, "MONTHLY", 2).toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(addInterval(start, "MONTHLY", 13).toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(addInterval(start, "ANNUAL", 2).toISOString()).toBe("2028-01-31T00:00:00.000Z");
  });
});

describe("prorationCreditPaise", () => {
  const start = new Date("2026-11-01T00:00:00Z");
  const end = new Date("2026-12-01T00:00:00Z");

  it("credits the unused share, rounded down", () => {
    const half = new Date("2026-11-16T00:00:00Z");
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 300_000,
        periodStart: start,
        periodEnd: end,
        now: half,
      }),
    ).toBe(150_000);
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 299_900,
        periodStart: start,
        periodEnd: end,
        now: half,
      }),
    ).toBe(149_950);
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 100,
        periodStart: start,
        periodEnd: end,
        now: new Date("2026-11-11T00:00:00Z"),
      }),
    ).toBe(66);
  });

  it("credits everything when the period has not started, and nothing once it has ended", () => {
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 500,
        periodStart: start,
        periodEnd: end,
        now: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toBe(500);
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 500,
        periodStart: start,
        periodEnd: end,
        now: end,
      }),
    ).toBe(0);
    expect(
      prorationCreditPaise({
        paidSubtotalPaise: 500,
        periodStart: start,
        periodEnd: end,
        now: new Date("2027-01-01T00:00:00Z"),
      }),
    ).toBe(0);
  });

  it("is never more than was paid", () => {
    for (let day = 0; day <= 30; day++) {
      const now = new Date(start.getTime() + day * 86_400_000);
      expect(
        prorationCreditPaise({
          paidSubtotalPaise: 799_900,
          periodStart: start,
          periodEnd: end,
          now,
        }),
      ).toBeLessThanOrEqual(799_900);
    }
  });
});

describe("financialYear and invoice numbers", () => {
  it("starts the year in April, by Indian time", () => {
    expect(financialYear(new Date("2026-04-01T00:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2026-03-31T23:59:00+05:30"))).toBe("2025-26");
    expect(financialYear(new Date("2027-03-31T12:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:00:00+05:30"))).toBe("2027-28");
    // 20:00 UTC on 31 March is already 1 April in India
    expect(financialYear(new Date("2026-03-31T20:00:00Z"))).toBe("2026-27");
  });

  it("formats the number with zero padding", () => {
    expect(formatInvoiceNumber("2026-27", 1)).toBe("RKB/2026-27/0001");
    expect(formatInvoiceNumber("2026-27", 123)).toBe("RKB/2026-27/0123");
    expect(formatInvoiceNumber("2026-27", 12345)).toBe("RKB/2026-27/12345");
  });
});

describe("formatPaise", () => {
  it("shows rupees, with paise only when there are some", () => {
    expect(formatPaise(799_900)).toBe("₹7,999");
    expect(formatPaise(943_882)).toBe("₹9,438.82");
    expect(formatPaise(0)).toBe("₹0");
  });
});
