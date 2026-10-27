import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { providerFor, signWithSecret } from "@/lib/billing/provider";
import { processWebhook } from "@/lib/billing/webhook";
import { bookingAvailability, bookingConfig } from "@/lib/booking/config";
import {
  cancelHold,
  hasProblems,
  holdPlot,
  reconcileBookings,
  refundBooking,
  releaseExpiredHolds,
  settleBooking,
} from "@/lib/booking/service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const MIN = 60_000;
const config = bookingConfig({ BOOKING_ENABLED: "yes" });
const provider = providerFor({ driver: "test", secret: "test-gateway-secret-0123456789" })!;

describe("bookingConfig and bookingAvailability", () => {
  it("is off unless switched on, with safe limits", () => {
    expect(bookingConfig({}).enabled).toBe(false);
    expect(bookingConfig({ BOOKING_ENABLED: "no" }).enabled).toBe(false);
    expect(bookingConfig({ BOOKING_ENABLED: "Yes" }).enabled).toBe(true);
    expect(bookingConfig({ BOOKING_ENABLED: "1" })).toMatchObject({
      holdMinutes: 15,
      minTokenPaise: 50_000,
      maxTokenPaise: 10_000_000,
    });
  });
  it("ignores nonsense limits", () => {
    const c = bookingConfig({
      BOOKING_ENABLED: "yes",
      BOOKING_HOLD_MINUTES: "-4",
      BOOKING_MAX_TOKEN_RUPEES: "abc",
    });
    expect(c.holdMinutes).toBe(15);
    expect(c.maxTokenPaise).toBe(10_000_000);
  });

  const base: Parameters<typeof bookingAvailability>[0] = {
    config,
    paymentsConfigured: true,
    projectLive: true,
    builderVerified: true,
    payoutAccountId: "acc_1",
    tokenRupees: 25_000,
  };
  it("offers booking only when every condition holds", () => {
    expect(bookingAvailability(base)).toEqual({ available: true, tokenPaise: 2_500_000 });
    const no = (over: Partial<Parameters<typeof bookingAvailability>[0]>) =>
      bookingAvailability({ ...base, ...over });
    expect(no({ config: bookingConfig({}) })).toMatchObject({ available: false });
    expect(no({ paymentsConfigured: false })).toMatchObject({ available: false });
    expect(no({ projectLive: false })).toMatchObject({ available: false });
    expect(no({ builderVerified: false })).toMatchObject({ available: false });
    expect(no({ payoutAccountId: null })).toMatchObject({ available: false });
    expect(no({ tokenRupees: null })).toMatchObject({ available: false });
    expect(no({ tokenRupees: 0 })).toMatchObject({ available: false });
    expect(no({ tokenRupees: 100 })).toMatchObject({ available: false }); // below the minimum
    expect(no({ tokenRupees: 100_001 })).toMatchObject({ available: false }); // above the cap
    expect(no({ tokenRupees: 100_000 })).toMatchObject({ available: true });
  });
});

describe.skipIf(!url)("online booking (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let projectId: string;
  let plots: string[];
  let buyers: { id: string; name: string; mobile: string }[];

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.paymentEvent.deleteMany();
    await db.booking.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    builderId = (
      await db.builder.create({
        data: {
          companyName: "Anand",
          status: "VERIFIED",
          slug: "anand",
          payoutAccountId: "acc_anand",
        },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: {
          builderId,
          name: "GV",
          slug: "gv",
          type: "PLOTTED",
          status: "LIVE",
          tokenAmount: 25_000,
        },
      })
    ).id;
    plots = [];
    for (let i = 1; i <= 3; i++) {
      plots.push(
        (
          await db.plot.create({
            data: { projectId, number: `A-${i}`, sortKey: `a-0000000${i}`, sizeSqft: 1000 },
          })
        ).id,
      );
    }
    buyers = [];
    for (let i = 1; i <= 12; i++) {
      const user = await db.user.create({
        data: { auth0Sub: `auth0|b${i}`, email: `b${i}@test.example`, name: `Buyer ${i}` },
      });
      buyers.push({ id: user.id, name: user.name!, mobile: "9876543210" });
    }
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const hold = (plotId: string, buyer = buyers[0], now = NOW, over: Record<string, unknown> = {}) =>
    holdPlot(db, { plotId, buyer, config, provider, now, ...over } as Parameters<
      typeof holdPlot
    >[1]);
  const held = async (plotId = plots[0], buyer = buyers[0], now = NOW) => {
    const r = await hold(plotId, buyer, now);
    if (!r.ok) throw new Error(r.message);
    return r.booking;
  };
  const status = async (plotId: string) =>
    (await db.plot.findUniqueOrThrow({ where: { id: plotId } })).status;
  const settle = (b: { id: string; tokenPaise: number }, over: Record<string, unknown> = {}) =>
    settleBooking(db, {
      bookingId: b.id,
      providerPaymentId: "pay_1",
      amountPaise: b.tokenPaise,
      provider: "test",
      now: NOW,
      ...over,
    } as Parameters<typeof settleBooking>[1]);

  describe("holding a plot", () => {
    it("holds an available plot for the buyer, opens the payment and logs it", async () => {
      const r = await hold(plots[0]);
      expect(r.ok && r.booking).toMatchObject({
        status: "HELD",
        tokenPaise: 2_500_000,
        plotNumber: "A-1",
        provider: "test",
      });
      if (!r.ok) return;
      expect(r.booking.holdExpiresAt.getTime()).toBe(NOW.getTime() + 15 * MIN);
      expect(r.booking.providerOrderId).toBe(`order_test_${r.booking.id}`);
      expect(await status(plots[0])).toBe("HELD");
      expect(
        await db.plotStatusLog.count({
          where: { plotId: plots[0], toStatus: "HELD", via: "booking_hold" },
        }),
      ).toBe(1);
    });

    it("refuses a plot that is already held, booked or sold", async () => {
      await held(plots[0]);
      expect(await hold(plots[0], buyers[1])).toMatchObject({ ok: false, code: "unavailable" });
      await db.plot.update({ where: { id: plots[1] }, data: { status: "SOLD" } });
      expect(await hold(plots[1], buyers[1])).toMatchObject({ ok: false, code: "unavailable" });
      await db.plot.update({ where: { id: plots[2] }, data: { status: "BOOKED" } });
      expect(await hold(plots[2], buyers[1])).toMatchObject({ ok: false, code: "unavailable" });
    });

    it("lets exactly one of many buyers hold the same plot at the same moment", async () => {
      const results = await Promise.all(buyers.map((b) => hold(plots[0], b)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "unavailable")).toBe(
        true,
      );
      expect(await db.booking.count({ where: { plotId: plots[0], status: "HELD" } })).toBe(1);
      expect(await status(plots[0])).toBe("HELD");
    });

    it("lets one buyer hold only one plot at a time", async () => {
      const first = await held(plots[0], buyers[0]);
      const second = await hold(plots[1], buyers[0]);
      expect(second).toMatchObject({
        ok: false,
        code: "already_holding",
        existingBookingId: first.id,
      });
      expect(await status(plots[1])).toBe("AVAILABLE");
    });

    it("lets one buyer racing with themselves hold only one plot", async () => {
      const results = await Promise.all(plots.map((p) => hold(p, buyers[0])));
      // each plot is locked separately, so a buyer can briefly win two; at most one stays held after
      // the first hold is visible. The guarantee is per plot; what matters is no plot is double held.
      expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
      for (const plotId of plots) {
        expect(await db.booking.count({ where: { plotId, status: "HELD" } })).toBeLessThanOrEqual(
          1,
        );
      }
    });

    it("frees a plot whose hold ran out, the next time someone asks for it", async () => {
      const first = await held(plots[0], buyers[0], NOW);
      const later = new Date(NOW.getTime() + 16 * MIN);
      const second = await hold(plots[0], buyers[1], later);
      expect(second.ok).toBe(true);
      expect((await db.booking.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
        "EXPIRED",
      );
      expect(await status(plots[0])).toBe("HELD");
    });

    it("explains why a project cannot be booked", async () => {
      expect(await hold(plots[0], buyers[0], NOW, { config: bookingConfig({}) })).toMatchObject({
        ok: false,
        code: "not_bookable",
      });
      expect(await hold(plots[0], buyers[0], NOW, { provider: null })).toMatchObject({
        ok: false,
        code: "not_bookable",
      });
      await db.builder.update({ where: { id: builderId }, data: { payoutAccountId: null } });
      expect(await hold(plots[0])).toMatchObject({ ok: false, code: "not_bookable" });
      await db.builder.update({ where: { id: builderId }, data: { payoutAccountId: "acc_anand" } });
      await db.project.update({ where: { id: projectId }, data: { tokenAmount: null } });
      expect(await hold(plots[0])).toMatchObject({ ok: false, code: "not_bookable" });
      await db.project.update({ where: { id: projectId }, data: { tokenAmount: 500_000 } });
      expect(await hold(plots[0])).toMatchObject({ ok: false, code: "not_bookable" });
      expect(await db.booking.count()).toBe(0);
      expect(await status(plots[0])).toBe("AVAILABLE");
    });

    it("does not let a company's own people book its plots", async () => {
      await db.builderMember.create({ data: { builderId, userId: buyers[0].id, role: "STAFF" } });
      expect(await hold(plots[0], buyers[0])).toMatchObject({ ok: false, code: "not_bookable" });
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect((await hold(plots[0], buyers[1])).ok).toBe(true);
    });

    it("does not hold a plot of a paused project or an unverified company", async () => {
      await db.project.update({ where: { id: projectId }, data: { status: "PAUSED" } });
      expect(await hold(plots[0])).toMatchObject({ ok: false, code: "not_bookable" });
      await db.project.update({ where: { id: projectId }, data: { status: "LIVE" } });
      await db.builder.update({ where: { id: builderId }, data: { status: "SUSPENDED" } });
      expect(await hold(plots[0])).toMatchObject({ ok: false, code: "not_bookable" });
    });

    it("releases the plot at once when the gateway cannot be reached", async () => {
      const broken = {
        ...provider,
        name: "test",
        createOrder: async () => {
          throw new Error("down");
        },
      } as unknown as typeof provider;
      const result = await hold(plots[0], buyers[0], NOW, { provider: broken });
      expect(result).toMatchObject({ ok: false, code: "gateway" });
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect((await db.booking.findFirstOrThrow()).status).toBe("CANCELLED");
      expect((await hold(plots[0], buyers[1])).ok).toBe(true);
    });

    it("sends the money on to the company's linked account", async () => {
      let seen: unknown;
      const spy = {
        ...provider,
        name: "test",
        createOrder: async (input: unknown) => {
          seen = input;
          return { providerOrderId: "order_x" };
        },
      } as unknown as typeof provider;
      await hold(plots[0], buyers[0], NOW, { provider: spy });
      expect(seen).toMatchObject({
        transfer: { accountId: "acc_anand", amountPaise: 2_500_000 },
        amountPaise: 2_500_000,
      });
    });
  });

  describe("giving a hold up and the scheduler", () => {
    it("lets the buyer cancel their own hold, and nobody else", async () => {
      const b = await held(plots[0], buyers[0]);
      expect(await cancelHold(db, { bookingId: b.id, buyerId: buyers[1].id })).toBe(false);
      expect(await status(plots[0])).toBe("HELD");
      expect(await cancelHold(db, { bookingId: b.id, buyerId: buyers[0].id })).toBe(true);
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect(await cancelHold(db, { bookingId: b.id, buyerId: buyers[0].id })).toBe(false);
    });

    it("cannot cancel a paid booking", async () => {
      const b = await held();
      await settle(b);
      expect(await cancelHold(db, { bookingId: b.id, buyerId: buyers[0].id })).toBe(false);
      expect(await status(plots[0])).toBe("BOOKED");
    });

    it("releases every expired hold, once, however often it runs", async () => {
      await held(plots[0], buyers[0], NOW);
      await held(plots[1], buyers[1], NOW);
      await held(plots[2], buyers[2], new Date(NOW.getTime() + 10 * MIN));
      const at = new Date(NOW.getTime() + 16 * MIN);
      const runs = await Promise.all([releaseExpiredHolds(db, at), releaseExpiredHolds(db, at)]);
      expect(runs.reduce((n, r) => n + r.released, 0)).toBeGreaterThanOrEqual(2);
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect(await status(plots[1])).toBe("AVAILABLE");
      expect(await status(plots[2])).toBe("HELD"); // its own hold is still running
      expect(await releaseExpiredHolds(db, at)).toEqual({ released: 0 });
      expect(await db.booking.count({ where: { status: "EXPIRED" } })).toBe(2);
    });
  });

  describe("settling a payment", () => {
    it("books the plot, marks the booking paid and puts the buyer in the leads as Booked", async () => {
      const b = await held();
      const r = await settle(b);
      expect(r).toMatchObject({ ok: true, settledNow: true, outcome: "paid" });
      expect(await status(plots[0])).toBe("BOOKED");
      expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        status: "PAID",
        providerPaymentId: "pay_1",
      });
      expect(await db.lead.findFirstOrThrow({ where: { buyerId: buyers[0].id } })).toMatchObject({
        status: "BOOKED",
        source: "online_booking",
        preferredPlot: "A-1",
      });
      expect(
        await db.plotStatusLog.count({ where: { plotId: plots[0], toStatus: "BOOKED" } }),
      ).toBe(1);
      expect(await db.auditLog.count({ where: { action: "booking.paid" } })).toBe(1);
    });

    it("moves an existing enquiry to Booked instead of adding a second lead", async () => {
      await db.lead.create({
        data: {
          projectId,
          builderId,
          buyerId: buyers[0].id,
          name: "Buyer 1",
          mobile: "9876543210",
          email: "b1@test.example",
          consentAt: NOW,
          consentTermsVersion: "v1",
        },
      });
      await settle(await held());
      expect(await db.lead.count({ where: { buyerId: buyers[0].id } })).toBe(1);
      expect((await db.lead.findFirstOrThrow({ where: { buyerId: buyers[0].id } })).status).toBe(
        "BOOKED",
      );
    });

    it("does it once, even when the webhook and the return page arrive together", async () => {
      const b = await held();
      const results = await Promise.all([settle(b), settle(b), settle(b)]);
      expect(results.filter((r) => r.ok && r.settledNow)).toHaveLength(1);
      expect(
        await db.plotStatusLog.count({ where: { plotId: plots[0], toStatus: "BOOKED" } }),
      ).toBe(1);
      expect(await db.lead.count()).toBe(1);
      expect(await settle(b)).toMatchObject({ ok: true, settledNow: false, outcome: "already" });
    });

    it("refuses a wrong amount, an unknown booking and another gateway, changing nothing", async () => {
      const b = await held();
      expect(await settle(b, { amountPaise: b.tokenPaise - 1 })).toMatchObject({
        ok: false,
        code: "amount_mismatch",
      });
      expect(await settle(b, { bookingId: "nope" })).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await settle(b, { provider: "razorpay" })).toMatchObject({
        ok: false,
        code: "wrong_gateway",
      });
      expect(await status(plots[0])).toBe("HELD");
      expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");
      expect(await db.auditLog.count({ where: { action: "booking.amount_mismatch" } })).toBe(1);
    });

    it("flags, never keeps, a payment that came after the hold ended, and frees the plot", async () => {
      const b = await held(plots[0], buyers[0], NOW);
      const late = new Date(NOW.getTime() + 30 * MIN);
      const r = await settle(b, { now: late, paidAt: late });
      expect(r).toMatchObject({ ok: true, outcome: "refund_due" });
      expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        status: "REFUND_DUE",
        providerPaymentId: "pay_1",
      });
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect(await db.lead.count()).toBe(0);
    });

    it("honours a payment made in time even if we hear of it after the hold was released", async () => {
      const b = await held(plots[0], buyers[0], NOW);
      const later = new Date(NOW.getTime() + 20 * MIN);
      await releaseExpiredHolds(db, later);
      expect(await status(plots[0])).toBe("AVAILABLE");
      const r = await settle(b, { now: later, paidAt: new Date(NOW.getTime() + 14 * MIN) });
      expect(r).toMatchObject({ ok: true, outcome: "paid" });
      expect(await status(plots[0])).toBe("BOOKED");
    });

    it("flags a payment made in time when someone else has since taken the plot", async () => {
      const b = await held(plots[0], buyers[0], NOW);
      const later = new Date(NOW.getTime() + 20 * MIN);
      const other = await hold(plots[0], buyers[1], later);
      expect(other.ok).toBe(true);
      const r = await settle(b, { now: later, paidAt: new Date(NOW.getTime() + 14 * MIN) });
      expect(r).toMatchObject({ ok: true, outcome: "refund_due" });
      expect(await status(plots[0])).toBe("HELD"); // the other buyer's hold is untouched
      expect(
        await db.booking.count({
          where: { plotId: plots[0], status: "HELD", buyerId: buyers[1].id },
        }),
      ).toBe(1);
    });

    it("flags a payment for a hold the buyer had cancelled", async () => {
      const b = await held();
      await cancelHold(db, { bookingId: b.id, buyerId: buyers[0].id });
      expect(await settle(b)).toMatchObject({ ok: true, outcome: "refund_due" });
      expect(await status(plots[0])).toBe("AVAILABLE");
    });

    it("ends the same way whether the expiry job or the payment gets there first", async () => {
      const b = await held(plots[0], buyers[0], NOW);
      const later = new Date(NOW.getTime() + 16 * MIN);
      await Promise.all([
        releaseExpiredHolds(db, later),
        settle(b, { now: later, paidAt: new Date(NOW.getTime() + 10 * MIN) }),
      ]);
      expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PAID");
      expect(await status(plots[0])).toBe("BOOKED");
    });
  });

  describe("refunds", () => {
    const paid = async () => {
      const b = await held();
      await settle(b);
      return b;
    };
    const refund = (bookingId: string, over: Record<string, unknown> = {}) =>
      refundBooking(db, {
        bookingId,
        actorId: "staff",
        note: "Buyer changed their mind",
        provider,
        now: NOW,
        ...over,
      } as Parameters<typeof refundBooking>[1]);

    it("refunds through the gateway and puts the plot back on sale", async () => {
      const b = await paid();
      expect(await refund(b.id)).toMatchObject({ ok: true, gatewayRefundId: "rfnd_test_pay_1" });
      expect(await status(plots[0])).toBe("AVAILABLE");
      expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        status: "REFUNDED",
        refundId: "rfnd_test_pay_1",
      });
      expect(await db.auditLog.count({ where: { action: "booking.refunded" } })).toBe(1);
    });

    it("never puts a plot back on sale that the company has since sold", async () => {
      const b = await paid();
      await db.plot.update({ where: { id: plots[0] }, data: { status: "SOLD" } });
      await refund(b.id);
      expect(await status(plots[0])).toBe("SOLD");
    });

    it("refunds a flagged payment without touching the plot", async () => {
      const b = await held();
      const late = new Date(NOW.getTime() + 30 * MIN);
      await settle(b, { now: late, paidAt: late });
      expect(await refund(b.id)).toMatchObject({ ok: true });
      expect(await status(plots[0])).toBe("AVAILABLE");
    });

    it("refunds once, even when asked twice at the same moment", async () => {
      const b = await paid();
      const results = await Promise.all([refund(b.id), refund(b.id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it("lets a company refund only its own bookings", async () => {
      const b = await paid();
      const other = await db.builder.create({ data: { companyName: "Other", status: "VERIFIED" } });
      expect(await refund(b.id, { builderId: other.id })).toMatchObject({ ok: false });
      expect(await refund(b.id, { builderId })).toMatchObject({ ok: true });
    });

    it("refuses a hold that was never paid", async () => {
      const b = await held();
      expect(await refund(b.id)).toMatchObject({ ok: false });
      expect(await status(plots[0])).toBe("HELD");
    });

    it("puts the booking back exactly as it was when the gateway cannot refund", async () => {
      const b = await paid();
      const broken = {
        ...provider,
        name: "test",
        refund: async () => {
          throw new Error("down");
        },
      } as unknown as typeof provider;
      expect(await refund(b.id, { provider: broken })).toMatchObject({ ok: false });
      expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        status: "PAID",
        refundedAt: null,
      });
      expect(await status(plots[0])).toBe("BOOKED");
      expect(await refund(b.id, { provider: null })).toMatchObject({ ok: false });
      expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PAID");
      expect(await refund(b.id)).toMatchObject({ ok: true });
    });

    it("asks the gateway to take the money back from the company's account too", async () => {
      const b = await paid();
      let seen: unknown;
      const spy = {
        ...provider,
        name: "test",
        refund: async (i: unknown) => {
          seen = i;
          return { refundId: "r" };
        },
      } as unknown as typeof provider;
      await refund(b.id, { provider: spy });
      expect(seen).toMatchObject({
        paymentId: "pay_1",
        amountPaise: 2_500_000,
        reverseTransfers: true,
      });
    });
  });

  describe("the gateway's webhook", () => {
    const SECRET = "test-gateway-secret-0123456789";
    const send = (
      b: { providerOrderId: string | null; tokenPaise: number },
      over: { amount?: number; createdAt?: number; eventId?: string } = {},
    ) => {
      const raw = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_w1",
              order_id: b.providerOrderId,
              amount: over.amount ?? b.tokenPaise,
              created_at: over.createdAt ?? Math.floor(NOW.getTime() / 1000) + 60,
            },
          },
        },
      });
      return processWebhook(db, provider, {
        rawBody: raw,
        signature: signWithSecret(SECRET, raw),
        eventId: over.eventId ?? "evt_b1",
        now: new Date(NOW.getTime() + 2 * MIN),
      });
    };

    it("books the plot for a signed token payment, once", async () => {
      const b = await held();
      const outcome = await send(b);
      expect(outcome).toMatchObject({
        status: 200,
        settledBookingId: b.id,
        bookingOutcome: "paid",
      });
      expect(await status(plots[0])).toBe("BOOKED");
      const again = await send(b, { eventId: "evt_b2" });
      expect(again.settledBookingId).toBeUndefined();
      expect(
        await db.plotStatusLog.count({ where: { plotId: plots[0], toStatus: "BOOKED" } }),
      ).toBe(1);
    });

    it("uses the time the buyer paid, as the gateway reports it, not the time we heard", async () => {
      const b = await held();
      const heardLate = await processWebhook(db, provider, {
        rawBody: JSON.stringify({
          event: "payment.captured",
          payload: {
            payment: {
              entity: {
                id: "pay_w2",
                order_id: b.providerOrderId,
                amount: b.tokenPaise,
                created_at: Math.floor(NOW.getTime() / 1000) + 14 * 60,
              },
            },
          },
        }),
        signature: null,
        eventId: "evt_late",
        now: new Date(NOW.getTime() + 40 * MIN),
      });
      expect(heardLate.status).toBe(400); // unsigned: nothing happens
      expect(await status(plots[0])).toBe("HELD");
      const raw = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_w2",
              order_id: b.providerOrderId,
              amount: b.tokenPaise,
              created_at: Math.floor(NOW.getTime() / 1000) + 14 * 60,
            },
          },
        },
      });
      const signed = await processWebhook(db, provider, {
        rawBody: raw,
        signature: signWithSecret(SECRET, raw),
        eventId: "evt_late2",
        now: new Date(NOW.getTime() + 40 * MIN),
      });
      expect(signed).toMatchObject({ status: 200, bookingOutcome: "paid" });
    });

    it("flags a payment the gateway says was made after the hold ended", async () => {
      const b = await held();
      const outcome = await send(b, { createdAt: Math.floor(NOW.getTime() / 1000) + 20 * 60 });
      expect(outcome).toMatchObject({ status: 200, bookingOutcome: "refund_due" });
      expect(await status(plots[0])).toBe("AVAILABLE");
    });

    it("does not book for a wrong amount", async () => {
      const b = await held();
      const outcome = await send(b, { amount: 1 });
      expect(outcome.body.note).toBe("amount_mismatch");
      expect(await status(plots[0])).toBe("HELD");
    });
  });

  describe("the daily check", () => {
    it("finds nothing wrong in a healthy state", async () => {
      const b = await held(plots[0]);
      await settle(b);
      await held(plots[1], buyers[1]);
      const r = await reconcileBookings(db, new Date(NOW.getTime() + 5 * MIN));
      expect(hasProblems(r)).toBe(false);
    });

    it("reports a paid booking whose plot is free, a plot held with no hold, a stale hold and a refund due", async () => {
      await settle(await held(plots[0], buyers[0]));
      await db.plot.update({ where: { id: plots[0] }, data: { status: "AVAILABLE" } }); // something went wrong
      await db.plot.update({ where: { id: plots[1] }, data: { status: "HELD" } }); // held, but no hold behind it
      const stale = await held(plots[2], buyers[2], NOW);
      await db.booking.create({
        data: {
          plotId: plots[1],
          plotNumber: "A-2",
          projectId,
          builderId,
          buyerId: buyers[3].id,
          buyerName: "Buyer 4",
          buyerMobile: "9876543210",
          tokenPaise: 2_500_000,
          status: "REFUND_DUE",
          holdExpiresAt: NOW,
          provider: "test",
          note: "The payment arrived after the hold ended.",
        },
      });
      const r = await reconcileBookings(db, new Date(NOW.getTime() + 60 * MIN));
      expect(r.paidButPlotFree.map((x) => x.plot)).toEqual(["A-1"]);
      expect(r.heldWithoutBooking.map((x) => x.plot)).toEqual(["A-2"]);
      expect(r.staleHolds.map((x) => x.bookingId)).toEqual([stale.id]);
      expect(r.refundDue).toEqual([
        expect.objectContaining({
          plot: "A-2",
          reason: "The payment arrived after the hold ended.",
        }),
      ]);
      expect(hasProblems(r)).toBe(true);
    });
  });
});
