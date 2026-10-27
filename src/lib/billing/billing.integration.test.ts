import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { entitlementsForBuilder } from "@/lib/entitlements";
import type { MailMessage } from "@/lib/mail";
import { expireSubscriptions, sendRenewalReminders } from "@/lib/billing/lifecycle";
import { assignSubscription, type Supplier } from "@/lib/billing/subscriptions";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md).
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-11-10T06:00:00.000Z");
const DAY = 86_400_000;
const supplier: Supplier = {
  name: "RKB Platform",
  gstin: "33AAAAA0000A1Z5",
  state: "Tamil Nadu",
  address: "Chennai",
  sac: "998439",
};

describe.skipIf(!url)("plans and invoices (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let sent: MailMessage[];
  const send = async (message: MailMessage) => {
    sent.push(message);
  };
  let builderId: string;

  beforeEach(async () => {
    sent = [];
    await db.auditLog.deleteMany();
    await db.invoice.deleteMany();
    await db.invoiceCounter.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    const owner = await db.user.create({
      data: { auth0Sub: "auth0|o", email: "owner@test.example" },
    });
    builderId = (
      await db.builder.create({
        data: {
          companyName: "Anand Realty",
          status: "VERIFIED",
          slug: "anand",
          state: "Karnataka",
          gstin: "29BBBBB1111B1Z6",
        },
      })
    ).id;
    await db.builderMember.create({ data: { builderId, userId: owner.id, role: "OWNER" } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const assign = (over: Partial<Parameters<typeof assignSubscription>[1]> = {}) =>
    assignSubscription(db, {
      builderId,
      plan: "GROWTH",
      interval: "MONTHLY",
      source: "MANUAL",
      periodEnd: new Date(NOW.getTime() + 30 * DAY),
      actorId: null,
      supplier,
      now: NOW,
      ...over,
    });

  describe("assignSubscription", () => {
    it("puts a company on a plan, and its entitlements follow", async () => {
      expect((await entitlementsForBuilder(db, builderId, NOW)).canPublish).toBe(false);
      await assign();
      expect(await entitlementsForBuilder(db, builderId, NOW)).toMatchObject({
        plan: "GROWTH",
        canPublish: true,
        maxProjects: 6,
      });
    });

    it("replaces the earlier plan and clears a scheduled change", async () => {
      await assign({ plan: "STARTER" });
      await db.subscription.update({
        where: { builderId },
        data: { cancelAtPeriodEnd: true, pendingPlan: "STARTER", lastReminderDays: 3 },
      });
      await assign({ plan: "PREMIER" });
      const sub = await db.subscription.findUniqueOrThrow({ where: { builderId } });
      expect(sub).toMatchObject({
        plan: "PREMIER",
        status: "ACTIVE",
        cancelAtPeriodEnd: false,
        pendingPlan: null,
        lastReminderDays: null,
      });
      expect(await db.subscription.count()).toBe(1);
    });

    it("refuses a period that ends before it starts", async () => {
      await expect(assign({ periodEnd: new Date(NOW.getTime() - DAY) })).rejects.toThrow(/after/);
    });

    it("issues a GST invoice that adds up: IGST across states, CGST and SGST inside one", async () => {
      const { invoice } = await assign({
        invoice: { subtotalPaise: 799_900, paymentMethod: "manual", paymentReference: "UTR123" },
      });
      expect(invoice).toMatchObject({
        number: "RKB/2026-27/0001",
        subtotalPaise: 799_900,
        igstPaise: 143_982,
        cgstPaise: 0,
        sgstPaise: 0,
        totalPaise: 943_882,
        status: "PAID",
        paymentReference: "UTR123",
      });
      expect(invoice!.billTo).toMatchObject({ name: "Anand Realty", gstin: "29BBBBB1111B1Z6" });

      await db.builder.update({ where: { id: builderId }, data: { state: "Tamil Nadu" } });
      const second = await assign({
        invoice: { subtotalPaise: 799_900, paymentMethod: "manual", paymentReference: null },
      });
      expect(second.invoice).toMatchObject({
        number: "RKB/2026-27/0002",
        igstPaise: 0,
        cgstPaise: 71_991,
        sgstPaise: 71_991,
      });
    });

    it("keeps the invoice number unique when payments land at the same moment", async () => {
      const others = await Promise.all(
        ["b", "c", "d", "e", "f"].map(async (n) => {
          const b = await db.builder.create({
            data: { companyName: `Co ${n}`, status: "VERIFIED", slug: `co-${n}` },
          });
          return b.id;
        }),
      );
      const results = await Promise.all(
        others.map((id) =>
          assign({
            builderId: id,
            invoice: { subtotalPaise: 100_000, paymentMethod: "manual", paymentReference: null },
          }),
        ),
      );
      const numbers = results.map((r) => r.invoice!.number).sort();
      expect(new Set(numbers).size).toBe(5);
      expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `RKB/2026-27/000${n}`));
    });

    it("starts a fresh sequence in a new financial year", async () => {
      await assign({
        invoice: { subtotalPaise: 100, paymentMethod: "manual", paymentReference: null },
      });
      const later = new Date("2027-04-02T06:00:00Z");
      const { invoice } = await assign({
        now: later,
        periodEnd: new Date(later.getTime() + 30 * DAY),
        invoice: { subtotalPaise: 100, paymentMethod: "manual", paymentReference: null },
      });
      expect(invoice!.number).toBe("RKB/2027-28/0001");
    });

    it("writes no invoice for a complimentary plan, and says so in the audit log", async () => {
      const { invoice } = await assign({ source: "COMP", actorId: null });
      expect(invoice).toBeNull();
      expect(await db.invoice.count()).toBe(0);
      expect(await db.auditLog.count({ where: { action: "subscription.assigned" } })).toBe(1);
    });

    it("brings back only the projects that were paused because the plan ended", async () => {
      const mk = (slug: string, pauseReason: string | null) =>
        db.project.create({
          data: {
            builderId,
            name: slug,
            slug,
            type: "PLOTTED",
            status: "PAUSED",
            pauseReason,
          },
        });
      const lapsed = await mk("lapsed", "PLAN_LAPSED");
      const byAdmin = await mk("by-admin", "ADMIN");
      const expiredApproval = await mk("approval", "APPROVAL_EXPIRED");
      const result = await assign();
      expect(result.resumedProjectIds).toEqual([lapsed.id]);
      const status = async (id: string) =>
        (await db.project.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(lapsed.id)).toBe("LIVE");
      expect(await status(byAdmin.id)).toBe("PAUSED");
      expect(await status(expiredApproval.id)).toBe("PAUSED");
    });
  });

  describe("expireSubscriptions", () => {
    const live = (slug: string) =>
      db.project.create({
        data: { builderId, name: slug, slug, type: "PLOTTED", status: "LIVE" },
      });

    it("leaves a plan alone through its grace days", async () => {
      await assign({
        periodEnd: new Date(NOW.getTime() - 2 * DAY),
        periodStart: new Date(NOW.getTime() - 32 * DAY),
      });
      const project = await live("p1");
      const result = await expireSubscriptions(db, NOW, send);
      expect(result.expired).toBe(0);
      expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
        "LIVE",
      );
    });

    it("ends the plan after the grace days, pauses live projects with a reason, and emails once", async () => {
      await assign({
        periodEnd: new Date(NOW.getTime() - 4 * DAY),
        periodStart: new Date(NOW.getTime() - 34 * DAY),
      });
      const p1 = await live("p1");
      const p2 = await live("p2");
      const draft = await db.project.create({
        data: { builderId, name: "d", slug: "d", type: "PLOTTED", status: "DRAFT" },
      });

      const first = await expireSubscriptions(db, NOW, send);
      expect(first.expired).toBe(1);
      expect(first.pausedProjectIds.sort()).toEqual([p1.id, p2.id].sort());
      const paused = await db.project.findUniqueOrThrow({ where: { id: p1.id } });
      expect(paused).toMatchObject({ status: "PAUSED", pauseReason: "PLAN_LAPSED" });
      expect((await db.project.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        "DRAFT",
      );
      expect((await db.subscription.findUniqueOrThrow({ where: { builderId } })).status).toBe(
        "EXPIRED",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toContain("owner@test.example");

      const again = await expireSubscriptions(db, NOW, send);
      expect(again.expired).toBe(0);
      expect(sent).toHaveLength(1);
    });

    it("running twice at once pauses each project once", async () => {
      await assign({
        periodEnd: new Date(NOW.getTime() - 4 * DAY),
        periodStart: new Date(NOW.getTime() - 34 * DAY),
      });
      await live("p1");
      const [a, b] = await Promise.all([
        expireSubscriptions(db, NOW, send),
        expireSubscriptions(db, NOW, send),
      ]);
      expect(a.expired + b.expired).toBe(1);
      expect(a.pausedProjectIds.length + b.pausedProjectIds.length).toBe(1);
      expect(sent).toHaveLength(1);
    });

    it("goes live again by itself when the company renews", async () => {
      await assign({
        periodEnd: new Date(NOW.getTime() - 4 * DAY),
        periodStart: new Date(NOW.getTime() - 34 * DAY),
      });
      const project = await live("p1");
      await expireSubscriptions(db, NOW, send);
      expect((await entitlementsForBuilder(db, builderId, NOW)).canPublish).toBe(false);
      await assign();
      expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
        "LIVE",
      );
      expect((await entitlementsForBuilder(db, builderId, NOW)).canPublish).toBe(true);
    });
  });

  describe("sendRenewalReminders", () => {
    it("reminds at 7, 3 and 1 days, once each", async () => {
      await assign({ periodEnd: new Date(NOW.getTime() + 6.5 * DAY) });
      expect((await sendRenewalReminders(db, NOW, send)).reminded).toBe(1);
      expect((await sendRenewalReminders(db, NOW, send)).reminded).toBe(0);
      expect(sent).toHaveLength(1);

      const threeDays = new Date(NOW.getTime() + 3.5 * DAY);
      expect((await sendRenewalReminders(db, threeDays, send)).reminded).toBe(1);
      expect((await sendRenewalReminders(db, threeDays, send)).reminded).toBe(0);

      const oneDay = new Date(NOW.getTime() + 5.7 * DAY);
      expect((await sendRenewalReminders(db, oneDay, send)).reminded).toBe(1);
      expect(sent).toHaveLength(3);
    });

    it("does not remind a plan that is far from ending, or already ended", async () => {
      await assign({ periodEnd: new Date(NOW.getTime() + 20 * DAY) });
      expect((await sendRenewalReminders(db, NOW, send)).reminded).toBe(0);
      await db.subscription.update({
        where: { builderId },
        data: { currentPeriodEnd: new Date(NOW.getTime() - DAY) },
      });
      expect((await sendRenewalReminders(db, NOW, send)).reminded).toBe(0);
    });

    it("starts the reminders over after a renewal", async () => {
      await assign({ periodEnd: new Date(NOW.getTime() + 2 * DAY) });
      await sendRenewalReminders(db, NOW, send);
      await assign({ periodEnd: new Date(NOW.getTime() + 2.5 * DAY) });
      expect((await sendRenewalReminders(db, NOW, send)).reminded).toBe(1);
    });
  });
});
