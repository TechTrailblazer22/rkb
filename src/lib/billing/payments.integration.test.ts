import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  clearScheduledChange,
  limitBlockers,
  scheduleChange,
  setCancelAtPeriodEnd,
} from "@/lib/billing/changes";
import { createCheckout, refundInvoice, settleOrder } from "@/lib/billing/payments";
import { addInterval } from "@/lib/billing/money";
import { providerFor, signWithSecret } from "@/lib/billing/provider";
import type { Supplier } from "@/lib/billing/subscriptions";
import { processWebhook } from "@/lib/billing/webhook";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T06:00:00.000Z");
const DAY = 86_400_000;
const SECRET = "test-gateway-secret-0123456789";
const supplier: Supplier = {
  name: "RKB Platform",
  gstin: "33AAAAA0000A1Z5",
  state: "Tamil Nadu",
  address: "Chennai",
  sac: "998439",
};
const provider = providerFor({ driver: "test", secret: SECRET })!;

describe.skipIf(!url)("payments (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let userId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.paymentEvent.deleteMany();
    await db.invoice.deleteMany();
    await db.invoiceCounter.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    userId = (
      await db.user.create({
        data: { auth0Sub: "auth0|o", email: "owner@test.example", role: "BUILDER_OWNER" },
      })
    ).id;
    builderId = (
      await db.builder.create({
        data: {
          companyName: "Anand Realty",
          status: "VERIFIED",
          slug: "anand",
          state: "Tamil Nadu",
        },
      })
    ).id;
    await db.builderMember.create({ data: { builderId, userId, role: "OWNER" } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const plan = (over: Record<string, unknown> = {}) =>
    db.subscription.create({
      data: {
        builderId,
        plan: "STARTER",
        interval: "MONTHLY",
        source: "GATEWAY",
        currentPeriodStart: new Date(NOW.getTime() - 15 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() + 15 * DAY),
        paidSubtotalPaise: 299_900,
        ...over,
      },
    });
  const checkout = async (
    target: "STARTER" | "GROWTH" | "PREMIER",
    interval: "MONTHLY" | "ANNUAL" = "MONTHLY",
  ) => {
    const result = await createCheckout(db, {
      builderId,
      userId,
      plan: target,
      interval,
      provider,
      supplier,
      now: NOW,
    });
    if (!result.ok) throw new Error(result.message);
    return result.order;
  };
  const settle = (
    order: { id: string; totalPaise: number },
    paymentId = "pay_1",
    over: Record<string, unknown> = {},
  ) =>
    settleOrder(db, {
      orderId: order.id,
      providerPaymentId: paymentId,
      amountPaise: order.totalPaise,
      provider: "test",
      supplier,
      now: NOW,
      ...over,
    });

  describe("starting a checkout", () => {
    it("turns a first purchase into an order for the list price plus GST", async () => {
      const order = await checkout("GROWTH");
      expect(order).toMatchObject({
        change: "SUBSCRIBE",
        plan: "GROWTH",
        listPaise: 799_900,
        creditPaise: 0,
        subtotalPaise: 799_900,
        totalPaise: 943_882,
        status: "CREATED",
        provider: "test",
      });
      expect(order.providerOrderId).toBe(`order_test_${order.id}`);
    });

    it("sets an unpaid order aside when a new one starts", async () => {
      const first = await checkout("GROWTH");
      const second = await checkout("PREMIER");
      expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
        "EXPIRED",
      );
      expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        "CREATED",
      );
    });

    it("refuses a company that is not verified", async () => {
      await db.builder.update({ where: { id: builderId }, data: { status: "SUBMITTED" } });
      const result = await createCheckout(db, {
        builderId,
        userId,
        plan: "GROWTH",
        interval: "MONTHLY",
        provider,
        supplier,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false });
      expect(await db.paymentOrder.count()).toBe(0);
    });

    it("does not create an order for a change that waits for the renewal", async () => {
      await plan({ plan: "PREMIER" });
      const result = await createCheckout(db, {
        builderId,
        userId,
        plan: "STARTER",
        interval: "MONTHLY",
        provider,
        supplier,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false });
      expect(await db.paymentOrder.count()).toBe(0);
    });

    it("prices an upgrade with the credit for the unused part", async () => {
      await plan();
      const order = await checkout("GROWTH");
      expect(order).toMatchObject({
        change: "UPGRADE",
        listPaise: 799_900,
        creditPaise: 149_950,
        subtotalPaise: 649_950,
      });
      expect(order.totalPaise).toBe(649_950 + Math.round(649_950 * 0.18));
    });

    it("marks the order failed, and says nothing was charged, when the gateway is down", async () => {
      const broken = {
        ...provider,
        name: "test",
        createOrder: async () => {
          throw new Error("down");
        },
      } as unknown as typeof provider;
      const result = await createCheckout(db, {
        builderId,
        userId,
        plan: "GROWTH",
        interval: "MONTHLY",
        provider: broken,
        supplier,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false });
      expect((await db.paymentOrder.findFirstOrThrow()).status).toBe("FAILED");
    });
  });

  describe("settling", () => {
    it("sets the plan, writes the invoice and marks the order paid, together", async () => {
      const order = await checkout("GROWTH");
      const result = await settle(order);
      expect(result).toMatchObject({ ok: true, settledNow: true });
      const sub = await db.subscription.findUniqueOrThrow({ where: { builderId } });
      expect(sub).toMatchObject({
        plan: "GROWTH",
        status: "ACTIVE",
        source: "GATEWAY",
        paidSubtotalPaise: 799_900,
      });
      expect(sub.currentPeriodEnd.toISOString()).toBe("2026-12-16T06:00:00.000Z");
      const invoice = await db.invoice.findFirstOrThrow();
      expect(invoice).toMatchObject({
        number: "RKB/2026-27/0001",
        totalPaise: 943_882,
        cgstPaise: 71_991,
        sgstPaise: 71_991,
        paymentMethod: "test",
        paymentReference: "pay_1",
        status: "PAID",
      });
      expect(invoice.supplier).toMatchObject({ gstin: "33AAAAA0000A1Z5" });
      expect(await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        status: "PAID",
        providerPaymentId: "pay_1",
        invoiceId: invoice.id,
      });
    });

    it("is safe to settle twice: one invoice, one plan change", async () => {
      const order = await checkout("GROWTH");
      await settle(order);
      const again = await settle(order, "pay_1");
      expect(again).toMatchObject({ ok: true, settledNow: false });
      expect(await db.invoice.count()).toBe(1);
    });

    it("is safe when the webhook and the return page arrive at the same moment", async () => {
      const order = await checkout("GROWTH");
      const results = await Promise.all([settle(order), settle(order), settle(order)]);
      expect(results.filter((r) => r.ok && r.settledNow)).toHaveLength(1);
      expect(await db.invoice.count()).toBe(1);
      expect(await db.auditLog.count({ where: { action: "payment.settled" } })).toBe(1);
    });

    it("refuses and records a payment of the wrong amount, and sets nothing", async () => {
      const order = await checkout("GROWTH");
      const result = await settle(order, "pay_1", { amountPaise: order.totalPaise - 1 });
      expect(result).toMatchObject({ ok: false, code: "amount_mismatch" });
      expect(await db.subscription.count()).toBe(0);
      expect(await db.invoice.count()).toBe(0);
      expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        "CREATED",
      );
      expect(await db.auditLog.count({ where: { action: "payment.amount_mismatch" } })).toBe(1);
    });

    it("refuses an unknown order and a payment from another gateway", async () => {
      expect(
        await settleOrder(db, {
          orderId: "nope",
          providerPaymentId: "p",
          amountPaise: 1,
          provider: "test",
          supplier,
          now: NOW,
        }),
      ).toMatchObject({ ok: false, code: "not_found" });
      const order = await checkout("GROWTH");
      expect(await settle(order, "pay_1", { provider: "razorpay" })).toMatchObject({
        ok: false,
        code: "not_verified",
      });
      expect(await db.subscription.count()).toBe(0);
    });

    it("still honours money that arrives for an order that was set aside", async () => {
      const first = await checkout("GROWTH");
      await checkout("PREMIER");
      expect((await settle(first)).ok).toBe(true);
      expect((await db.subscription.findUniqueOrThrow({ where: { builderId } })).plan).toBe(
        "GROWTH",
      );
    });

    it("renews from the end of the paid period and adds to what was paid", async () => {
      await plan();
      const order = await checkout("STARTER");
      expect(order.change).toBe("RENEW");
      await settle(order);
      const sub = await db.subscription.findUniqueOrThrow({ where: { builderId } });
      expect(sub.currentPeriodEnd).toEqual(
        addInterval(new Date(NOW.getTime() + 15 * DAY), "MONTHLY"),
      );
      expect(sub.paidSubtotalPaise).toBe(299_900 * 2);
    });

    it("renews from now when the plan is already late, and so loses no paid day", async () => {
      await plan({
        currentPeriodStart: new Date(NOW.getTime() - 31 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() - DAY),
      });
      const order = await checkout("STARTER");
      await settle(order);
      const sub = await db.subscription.findUniqueOrThrow({ where: { builderId } });
      expect(sub.currentPeriodStart.toISOString()).toBe(NOW.toISOString());
      expect(sub.paidSubtotalPaise).toBe(299_900);
    });

    it("mentions the credit on an upgrade invoice, and clears a scheduled change", async () => {
      await plan({ pendingPlan: "STARTER", cancelAtPeriodEnd: true });
      const order = await checkout("GROWTH");
      await settle(order);
      const invoice = await db.invoice.findFirstOrThrow();
      expect(invoice.description).toContain("credit");
      expect(await db.subscription.findUniqueOrThrow({ where: { builderId } })).toMatchObject({
        pendingPlan: null,
        cancelAtPeriodEnd: false,
      });
    });

    it("brings back projects that were paused when the plan lapsed", async () => {
      const project = await db.project.create({
        data: {
          builderId,
          name: "P",
          slug: "p",
          type: "PLOTTED",
          status: "PAUSED",
          pauseReason: "PLAN_LAPSED",
        },
      });
      const order = await checkout("GROWTH");
      const result = await settle(order);
      expect(result.ok && result.resumedProjectIds).toEqual([project.id]);
      expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
        "LIVE",
      );
    });
  });

  describe("the gateway's webhook", () => {
    const body = (
      type: string,
      order: { providerOrderId: string | null; totalPaise: number },
      paymentId = "pay_9",
      amount?: number,
    ) =>
      JSON.stringify({
        event: type,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: order.providerOrderId,
              amount: amount ?? order.totalPaise,
            },
          },
        },
      });
    const send = (raw: string, over: { signature?: string | null; eventId?: string | null } = {}) =>
      processWebhook(db, provider, {
        rawBody: raw,
        signature: over.signature === undefined ? signWithSecret(SECRET, raw) : over.signature,
        eventId: over.eventId === undefined ? "evt_1" : over.eventId,
        supplier,
        now: NOW,
      });

    it("settles the order for a correctly signed payment", async () => {
      const order = await checkout("GROWTH");
      const outcome = await send(body("payment.captured", order));
      expect(outcome).toMatchObject({ status: 200, settledOrderId: expect.any(String) });
      expect((await db.subscription.findUniqueOrThrow({ where: { builderId } })).plan).toBe(
        "GROWTH",
      );
      expect(await db.paymentEvent.count()).toBe(1);
    });

    it("rejects a wrong or missing signature and changes nothing", async () => {
      const order = await checkout("GROWTH");
      const raw = body("payment.captured", order);
      expect(
        (await send(raw, { signature: "00" + signWithSecret(SECRET, raw).slice(2) })).status,
      ).toBe(400);
      expect((await send(raw, { signature: null })).status).toBe(400);
      expect(
        (await send(raw, { signature: signWithSecret("another-secret-0123456789", raw) })).status,
      ).toBe(400);
      expect(await db.subscription.count()).toBe(0);
      expect(await db.paymentEvent.count()).toBe(0);
    });

    it("rejects a body that was changed after it was signed", async () => {
      const order = await checkout("GROWTH");
      const raw = body("payment.captured", order);
      const signature = signWithSecret(SECRET, raw);
      const tampered = raw.replace("pay_9", "pay_8");
      expect((await send(tampered, { signature })).status).toBe(400);
    });

    it("ignores a repeat of the same event, and a replay under another event id", async () => {
      const order = await checkout("GROWTH");
      const raw = body("payment.captured", order);
      await send(raw);
      expect((await send(raw)).body.note).toBe("already handled");
      expect((await send(raw, { eventId: "evt_2" })).body.note).toBe("already settled");
      expect(await db.invoice.count()).toBe(1);
    });

    it("handles the same event arriving twice at once", async () => {
      const order = await checkout("GROWTH");
      const raw = body("payment.captured", order);
      const results = await Promise.all([send(raw), send(raw), send(raw)]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await db.invoice.count()).toBe(1);
      expect(await db.paymentEvent.count()).toBe(1);
    });

    it("does not settle for a wrong amount, but still answers 200 so it is not resent forever", async () => {
      const order = await checkout("GROWTH");
      const outcome = await send(body("payment.captured", order, "pay_9", order.totalPaise - 100));
      expect(outcome).toMatchObject({ status: 200, body: { note: "amount_mismatch" } });
      expect(await db.subscription.count()).toBe(0);
    });

    it("notes a failed attempt on the order, leaving it open to try again", async () => {
      const order = await checkout("GROWTH");
      await send(
        JSON.stringify({
          event: "payment.failed",
          payload: {
            payment: {
              entity: {
                id: "pay_x",
                order_id: order.providerOrderId,
                error_description: "Card declined",
              },
            },
          },
        }),
      );
      expect(await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        status: "CREATED",
        failureReason: "Card declined",
      });
      await send(body("payment.captured", order), { eventId: "evt_retry" });
      expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        "PAID",
      );
    });

    it("acknowledges an event for an order it does not know, and unrelated events", async () => {
      expect(
        (await send(body("payment.captured", { providerOrderId: "order_unknown", totalPaise: 1 })))
          .status,
      ).toBe(200);
      expect(
        (await send(JSON.stringify({ event: "refund.created", payload: {} }), { eventId: "evt_3" }))
          .status,
      ).toBe(200);
      expect((await send("not json at all")).status).toBe(400);
      expect(await db.subscription.count()).toBe(0);
    });
  });

  describe("refunds", () => {
    it("refunds an online payment through the gateway and marks the invoice", async () => {
      const order = await checkout("GROWTH");
      await settle(order);
      const invoice = await db.invoice.findFirstOrThrow();
      const result = await refundInvoice(db, {
        invoiceId: invoice.id,
        note: "Duplicate payment",
        actorId: userId,
        provider,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, gatewayRefundId: "rfnd_test_pay_1" });
      expect(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
        status: "REFUNDED",
        refundNote: "Duplicate payment",
      });
      expect(await db.auditLog.count({ where: { action: "invoice.refunded" } })).toBe(1);
    });

    it("never refunds the same invoice twice", async () => {
      const order = await checkout("GROWTH");
      await settle(order);
      const invoice = await db.invoice.findFirstOrThrow();
      const args = { invoiceId: invoice.id, note: "x", actorId: userId, provider, now: NOW };
      const results = await Promise.all([refundInvoice(db, args), refundInvoice(db, args)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it("puts the invoice back when the gateway cannot refund", async () => {
      const order = await checkout("GROWTH");
      await settle(order);
      const invoice = await db.invoice.findFirstOrThrow();
      const broken = {
        ...provider,
        name: "test",
        refund: async () => {
          throw new Error("down");
        },
      } as unknown as typeof provider;
      expect(
        await refundInvoice(db, {
          invoiceId: invoice.id,
          note: "x",
          actorId: userId,
          provider: broken,
          now: NOW,
        }),
      ).toMatchObject({ ok: false });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        "PAID",
      );
    });

    it("marks an offline payment refunded without the gateway, and refuses an online one with no gateway", async () => {
      const order = await checkout("GROWTH");
      await settle(order);
      const online = await db.invoice.findFirstOrThrow();
      expect(
        await refundInvoice(db, {
          invoiceId: online.id,
          note: "x",
          actorId: userId,
          provider: null,
          now: NOW,
        }),
      ).toMatchObject({ ok: false });
      const manual = await db.invoice.create({
        data: {
          number: "RKB/2026-27/0099",
          builderId,
          description: "d",
          plan: "GROWTH",
          interval: "MONTHLY",
          periodStart: NOW,
          periodEnd: NOW,
          subtotalPaise: 100,
          totalPaise: 118,
          paymentMethod: "manual",
          billTo: {},
          sac: "998439",
        },
      });
      expect(
        await refundInvoice(db, {
          invoiceId: manual.id,
          note: "bank transfer returned",
          actorId: userId,
          provider: null,
          now: NOW,
        }),
      ).toEqual({ ok: true, gatewayRefundId: null });
    });
  });

  describe("changing the plan without paying", () => {
    it("lists exactly what stands in the way of a smaller plan", async () => {
      await plan({ plan: "PREMIER" });
      for (let i = 0; i < 8; i++) {
        await db.project.create({
          data: {
            builderId,
            name: `P${i}`,
            slug: `p${i}`,
            type: "PLOTTED",
            status: "DRAFT",
            videoUrl: i === 0 ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : null,
            tourUrl: i === 1 ? "https://my.matterport.com/x" : null,
          },
        });
      }
      const blockers = await limitBlockers(db, builderId, "STARTER", NOW);
      expect(blockers.join("\n")).toContain("8 projects and Starter allows 2. Archive 6 projects");
      expect(blockers.join("\n")).toContain("does not include video");
      expect(blockers.join("\n")).toContain("does not include a 360° tour");
      expect(await limitBlockers(db, builderId, "PREMIER", NOW)).toEqual([]);
    });

    it("counts people and invitations against the seats, and photos against the cap", async () => {
      await plan({ plan: "PREMIER" });
      const other = await db.user.create({
        data: { auth0Sub: "auth0|t", email: "t@test.example" },
      });
      await db.builderMember.create({ data: { builderId, userId: other.id, role: "MANAGER" } });
      await db.teamInvite.create({
        data: {
          builderId,
          email: "n@test.example",
          role: "STAFF",
          tokenHash: "h",
          invitedById: userId,
          expiresAt: new Date(NOW.getTime() + DAY),
        },
      });
      const blockers = await limitBlockers(db, builderId, "STARTER", NOW);
      expect(blockers.join("\n")).toContain("2 people and 1 invitation waiting");
      const project = await db.project.create({
        data: { builderId, name: "Big", slug: "big", type: "PLOTTED" },
      });
      await db.projectMedia.createMany({
        data: Array.from({ length: 16 }, (_, i) => ({
          projectId: project.id,
          kind: "PHOTO" as const,
          storageKey: `k${i}`,
          mimeType: "image/jpeg",
          sizeBytes: 1,
          originalName: `${i}.jpg`,
          uploadedById: userId,
        })),
      });
      expect((await limitBlockers(db, builderId, "STARTER", NOW)).join("\n")).toContain(
        '"Big" has 16 photos and Starter allows 15',
      );
    });

    it("schedules a downgrade when nothing is in the way, and refuses otherwise", async () => {
      await plan({ plan: "GROWTH" });
      expect(
        await scheduleChange(db, {
          builderId,
          actorId: userId,
          plan: "STARTER",
          interval: "MONTHLY",
          now: NOW,
        }),
      ).toEqual({ ok: true });
      expect(await db.subscription.findUniqueOrThrow({ where: { builderId } })).toMatchObject({
        pendingPlan: "STARTER",
        pendingInterval: "MONTHLY",
      });
      await clearScheduledChange(db, { builderId, actorId: userId });
      expect(
        (await db.subscription.findUniqueOrThrow({ where: { builderId } })).pendingPlan,
      ).toBeNull();

      for (let i = 0; i < 3; i++)
        await db.project.create({
          data: { builderId, name: `P${i}`, slug: `q${i}`, type: "PLOTTED" },
        });
      const refused = await scheduleChange(db, {
        builderId,
        actorId: userId,
        plan: "STARTER",
        interval: "MONTHLY",
        now: NOW,
      });
      expect(refused).toMatchObject({ ok: false });
      expect(refused.ok === false && refused.blockers?.[0]).toContain("Archive 1 project");
      expect(
        (await db.subscription.findUniqueOrThrow({ where: { builderId } })).pendingPlan,
      ).toBeNull();
    });

    it("lets a company cancel and change its mind, keeping the plan to the end", async () => {
      await plan();
      expect(await setCancelAtPeriodEnd(db, { builderId, actorId: userId, cancel: true })).toBe(
        true,
      );
      expect(
        (await db.subscription.findUniqueOrThrow({ where: { builderId } })).cancelAtPeriodEnd,
      ).toBe(true);
      expect(await setCancelAtPeriodEnd(db, { builderId, actorId: userId, cancel: false })).toBe(
        true,
      );
      await db.subscription.update({ where: { builderId }, data: { status: "EXPIRED" } });
      expect(await setCancelAtPeriodEnd(db, { builderId, actorId: userId, cancel: true })).toBe(
        false,
      );
    });
  });
});
