import { describe, expect, it } from "vitest";
import { quoteChange, type CurrentPlan } from "@/lib/billing/quote";

const NOW = new Date("2026-11-16T00:00:00Z");
const DAY = 86_400_000;
const base = (over: Partial<CurrentPlan> = {}): CurrentPlan => ({
  plan: "STARTER",
  interval: "MONTHLY",
  status: "ACTIVE",
  currentPeriodStart: new Date("2026-11-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
  paidSubtotalPaise: 299_900,
  pendingPlan: null,
  pendingInterval: null,
  ...over,
});
const quote = (
  current: CurrentPlan | null,
  plan: "STARTER" | "GROWTH" | "PREMIER",
  interval: "MONTHLY" | "ANNUAL" = "MONTHLY",
  customerState: string | null = "Tamil Nadu",
) =>
  quoteChange({
    current,
    target: { plan, interval },
    now: NOW,
    supplierState: "Tamil Nadu",
    customerState,
  });

describe("subscribing", () => {
  it("charges the list price plus GST for a company with no plan", () => {
    const q = quote(null, "GROWTH");
    expect(q).toMatchObject({
      kind: "pay",
      change: "SUBSCRIBE",
      listPaise: 799_900,
      creditPaise: 0,
      subtotalPaise: 799_900,
    });
    if (q.kind !== "pay") return;
    expect(q.gst.totalPaise).toBe(943_882);
    expect(q.periodStart).toEqual(NOW);
    expect(q.periodEnd.toISOString()).toBe("2026-12-16T00:00:00.000Z");
  });

  it("charges ten months for a year, and the year runs twelve", () => {
    const q = quote(null, "GROWTH", "ANNUAL");
    expect(q).toMatchObject({ kind: "pay", listPaise: 7_999_000 });
    if (q.kind === "pay") expect(q.periodEnd.toISOString()).toBe("2027-11-16T00:00:00.000Z");
  });

  it("starts afresh when the old plan ended beyond the grace days", () => {
    const ended = base({
      currentPeriodEnd: new Date(NOW.getTime() - 5 * DAY),
      currentPeriodStart: new Date(NOW.getTime() - 35 * DAY),
    });
    expect(quote(ended, "STARTER")).toMatchObject({ kind: "pay", change: "SUBSCRIBE" });
    expect(quote(base({ status: "EXPIRED" }), "STARTER")).toMatchObject({ change: "SUBSCRIBE" });
  });

  it("uses IGST for another state, CGST and SGST for the same one", () => {
    const same = quote(null, "STARTER", "MONTHLY", "Tamil Nadu");
    const other = quote(null, "STARTER", "MONTHLY", "Karnataka");
    if (same.kind !== "pay" || other.kind !== "pay") throw new Error("expected pay quotes");
    expect(same.gst.igstPaise).toBe(0);
    expect(other.gst.cgstPaise + other.gst.sgstPaise).toBe(0);
    expect(other.gst.totalPaise).toBe(same.gst.totalPaise);
  });
});

describe("renewing", () => {
  it("extends from the end of the paid period, so paying early loses no days", () => {
    const q = quote(base(), "STARTER");
    expect(q).toMatchObject({ kind: "pay", change: "RENEW", creditPaise: 0 });
    if (q.kind !== "pay") return;
    expect(q.periodStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(q.periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("starts from now when the plan is already late (inside the grace days)", () => {
    const late = base({
      currentPeriodStart: new Date(NOW.getTime() - 31 * DAY),
      currentPeriodEnd: new Date(NOW.getTime() - DAY),
    });
    const q = quote(late, "STARTER");
    if (q.kind !== "pay") throw new Error("expected a pay quote");
    expect(q.change).toBe("RENEW");
    expect(q.periodStart).toEqual(NOW);
    expect(q.periodEnd.toISOString()).toBe("2026-12-16T00:00:00.000Z");
  });

  it("will not stockpile more than a year ahead", () => {
    const far = base({ currentPeriodEnd: new Date(NOW.getTime() + 400 * DAY) });
    expect(quote(far, "STARTER")).toMatchObject({ kind: "none" });
  });
});

describe("upgrading", () => {
  it("starts now and credits the unused part of what was paid", () => {
    // 15 of 30 days left on a plan paid at 2,999: 1,499.50 credit
    const q = quote(base(), "GROWTH");
    expect(q).toMatchObject({
      kind: "pay",
      change: "UPGRADE",
      listPaise: 799_900,
      creditPaise: 149_950,
      subtotalPaise: 649_950,
    });
    if (q.kind !== "pay") return;
    expect(q.periodStart).toEqual(NOW);
    expect(q.periodEnd.toISOString()).toBe("2026-12-16T00:00:00.000Z");
  });

  it("gives no credit for a complimentary plan, which paid nothing", () => {
    const q = quote(base({ paidSubtotalPaise: 0 }), "GROWTH");
    expect(q).toMatchObject({ change: "UPGRADE", creditPaise: 0, subtotalPaise: 799_900 });
  });

  it("moves from monthly to annual of the same plan, with credit", () => {
    const q = quote(base({ plan: "GROWTH", paidSubtotalPaise: 799_900 }), "GROWTH", "ANNUAL");
    expect(q).toMatchObject({ kind: "pay", change: "UPGRADE" });
    if (q.kind === "pay") expect(q.subtotalPaise).toBe(7_999_000 - q.creditPaise);
  });

  it("never credits more than the new period costs", () => {
    const q = quote(base({ paidSubtotalPaise: 99_999_999 }), "GROWTH");
    expect(q).toMatchObject({ kind: "pay", creditPaise: 799_900, subtotalPaise: 0 });
  });

  it("gives no credit once the paid period is over (late, in the grace days)", () => {
    const late = base({
      currentPeriodStart: new Date(NOW.getTime() - 31 * DAY),
      currentPeriodEnd: new Date(NOW.getTime() - DAY),
    });
    expect(quote(late, "GROWTH")).toMatchObject({ change: "SUBSCRIBE", creditPaise: 0 });
  });

  it("lets a scheduled cheaper plan be bought once the paid period is over", () => {
    const late = base({
      plan: "PREMIER",
      pendingPlan: "GROWTH",
      currentPeriodStart: new Date(NOW.getTime() - 31 * DAY),
      currentPeriodEnd: new Date(NOW.getTime() - DAY),
    });
    const q = quote(late, "GROWTH");
    expect(q).toMatchObject({
      kind: "pay",
      change: "SUBSCRIBE",
      creditPaise: 0,
      listPaise: 799_900,
    });
    if (q.kind === "pay") expect(q.periodStart).toEqual(NOW);
  });
});

describe("downgrading and other changes that wait", () => {
  it("schedules a cheaper plan for the end of the period, and charges nothing now", () => {
    const current = base({ plan: "PREMIER" });
    expect(quote(current, "GROWTH")).toEqual({
      kind: "schedule",
      plan: "GROWTH",
      interval: "MONTHLY",
      effectiveOn: current.currentPeriodEnd,
    });
  });

  it("schedules annual to monthly, even to a higher plan", () => {
    const current = base({ interval: "ANNUAL" });
    expect(quote(current, "STARTER", "MONTHLY")).toMatchObject({ kind: "schedule" });
    expect(quote(current, "GROWTH", "MONTHLY")).toMatchObject({ kind: "schedule" });
  });

  it("upgrades annual to a higher annual plan straight away", () => {
    expect(quote(base({ interval: "ANNUAL" }), "GROWTH", "ANNUAL")).toMatchObject({
      kind: "pay",
      change: "UPGRADE",
    });
  });
});
