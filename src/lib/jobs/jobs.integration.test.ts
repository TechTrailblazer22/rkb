import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { MailMessage } from "@/lib/mail";
import { processApprovalExpiry } from "@/lib/jobs/approval-expiry";
import { sendDailyDigests } from "@/lib/jobs/digest";
import { sendFollowUpReminders } from "@/lib/jobs/follow-ups";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md):
//   TEST_DATABASE_URL=postgresql://... npm test
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-11-10T06:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plan = (builderId: string, plan: "STARTER" | "GROWTH" = "GROWTH") => ({
  builderId,
  plan,
  interval: "MONTHLY" as const,
  source: "COMP" as const,
  currentPeriodStart: new Date(NOW.getTime() - 5 * DAY),
  currentPeriodEnd: new Date(NOW.getTime() + 25 * DAY),
});
const day = (offset: number) => new Date(Date.UTC(2026, 10, 10 + offset));

describe.skipIf(!url)("scheduled jobs (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let sent: MailMessage[];
  const send = async (message: MailMessage) => {
    sent.push(message);
  };
  let builderId: string;
  let projectId: string;
  let buyerId: string;

  beforeEach(async () => {
    sent = [];
    await db.auditLog.deleteMany();
    await db.lead.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    const owner = await db.user.create({
      data: { auth0Sub: "auth0|o", email: "owner@test.example" },
    });
    const buyer = await db.user.create({
      data: { auth0Sub: "auth0|b", email: "buyer@test.example" },
    });
    buyerId = buyer.id;
    builderId = (
      await db.builder.create({
        data: { companyName: "Anand Realty", status: "VERIFIED", slug: "anand" },
      })
    ).id;
    await db.builderMember.create({ data: { builderId, userId: owner.id, role: "OWNER" } });
    await db.subscription.create({ data: plan(builderId) });
    projectId = (
      await db.project.create({
        data: {
          builderId,
          name: "Green Valley",
          type: "PLOTTED",
          status: "LIVE",
          slug: "green-valley",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const lead = (data: Partial<Parameters<typeof db.lead.create>[0]["data"]> = {}) =>
    db.lead.create({
      data: {
        projectId,
        builderId,
        buyerId,
        name: "Asha",
        mobile: "9876543210",
        email: "buyer@test.example",
        consentAt: NOW,
        consentTermsVersion: "v1",
        ...data,
      } as Parameters<typeof db.lead.create>[0]["data"],
    });

  describe("follow-up reminders", () => {
    it("emails the owner about leads whose date has come, in one message", async () => {
      await lead({ name: "Asha", followUpAt: new Date(NOW.getTime() - HOUR) });
      await lead({ name: "Ravi", followUpAt: new Date(NOW.getTime() - 2 * HOUR) });
      const result = await sendFollowUpReminders(db, NOW, send);
      expect(result).toEqual({ leads: 2, emails: 1 });
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toEqual(["owner@test.example"]);
      expect(sent[0].text).toContain("Asha (Green Valley)");
      expect(sent[0].text).toContain("Ravi (Green Valley)");
    });

    it("sends nothing for a date still to come, no date, or a finished lead", async () => {
      await lead({ followUpAt: new Date(NOW.getTime() + DAY) });
      await lead({ followUpAt: null });
      await lead({ followUpAt: new Date(NOW.getTime() - HOUR), status: "LOST" });
      await lead({ followUpAt: new Date(NOW.getTime() - HOUR), status: "BOOKED" });
      expect(await sendFollowUpReminders(db, NOW, send)).toEqual({ leads: 0, emails: 0 });
      expect(sent).toHaveLength(0);
    });

    it("sends no reminders to a company on the basic lead dashboard or with no plan", async () => {
      await lead({ followUpAt: new Date(NOW.getTime() - HOUR) });
      await db.subscription.update({ where: { builderId }, data: { plan: "STARTER" } });
      expect(await sendFollowUpReminders(db, NOW, send)).toEqual({ leads: 0, emails: 0 });
      await db.subscription.update({
        where: { builderId },
        data: { plan: "GROWTH", currentPeriodEnd: new Date(NOW.getTime() - 5 * DAY) },
      });
      expect(await sendFollowUpReminders(db, NOW, send)).toEqual({ leads: 0, emails: 0 });
      expect(sent).toHaveLength(0);
      // the reminder is not used up: it goes out once the company is on a full plan again
      await db.subscription.update({
        where: { builderId },
        data: { currentPeriodEnd: new Date(NOW.getTime() + DAY) },
      });
      expect(await sendFollowUpReminders(db, NOW, send)).toEqual({ leads: 1, emails: 1 });
    });

    it("never sends the same reminder twice, even if the job runs twice or at once", async () => {
      await lead({ followUpAt: new Date(NOW.getTime() - HOUR) });
      await Promise.all([
        sendFollowUpReminders(db, NOW, send),
        sendFollowUpReminders(db, NOW, send),
      ]);
      await sendFollowUpReminders(db, new Date(NOW.getTime() + HOUR), send);
      expect(sent).toHaveLength(1);
    });

    it("reminds again after the follow-up date is changed", async () => {
      const created = await lead({ followUpAt: new Date(NOW.getTime() - HOUR) });
      await sendFollowUpReminders(db, NOW, send);
      await db.lead.update({
        where: { id: created.id },
        data: { followUpAt: new Date(NOW.getTime() + DAY), reminderSentAt: null },
      });
      await sendFollowUpReminders(db, new Date(NOW.getTime() + 2 * DAY), send);
      expect(sent).toHaveLength(2);
    });

    it("sends one email per company, to that company only", async () => {
      const other = await db.builder.create({
        data: { companyName: "Other", status: "VERIFIED", slug: "other" },
      });
      const otherOwner = await db.user.create({
        data: { auth0Sub: "auth0|o2", email: "other@test.example" },
      });
      await db.builderMember.create({
        data: { builderId: other.id, userId: otherOwner.id, role: "OWNER" },
      });
      await db.subscription.create({ data: plan(other.id) });
      const otherProject = await db.project.create({
        data: {
          builderId: other.id,
          name: "Lake View",
          type: "PLOTTED",
          status: "LIVE",
          slug: "lake",
        },
      });
      await lead({ followUpAt: new Date(NOW.getTime() - HOUR) });
      await lead({
        projectId: otherProject.id,
        builderId: other.id,
        followUpAt: new Date(NOW.getTime() - HOUR),
      });
      await sendFollowUpReminders(db, NOW, send);
      expect(sent.map((m) => m.to).sort()).toEqual([
        ["other@test.example"],
        ["owner@test.example"],
      ]);
      const forOwner = sent.find((m) => (m.to as string[])[0] === "owner@test.example");
      expect(forOwner?.text).not.toContain("Lake View");
    });
  });

  describe("daily summary", () => {
    it("tells a company how many enquiries arrived, once", async () => {
      await lead({ createdAt: new Date(NOW.getTime() - 3 * HOUR) });
      await lead({ createdAt: new Date(NOW.getTime() - 2 * HOUR), name: "Ravi" });
      expect(await sendDailyDigests(db, NOW, send)).toEqual({ emails: 1 });
      expect(sent[0].text).toContain("2 new enquiries");
      expect(sent[0].to).toEqual(["owner@test.example"]);
    });

    it("sends nothing when nothing new arrived", async () => {
      await lead({ createdAt: new Date(NOW.getTime() - 5 * DAY) });
      expect(await sendDailyDigests(db, NOW, send)).toEqual({ emails: 0 });
    });

    it("sends at most one a day however often the job runs, even at once", async () => {
      await lead({ createdAt: new Date(NOW.getTime() - HOUR) });
      await Promise.all([sendDailyDigests(db, NOW, send), sendDailyDigests(db, NOW, send)]);
      await sendDailyDigests(db, new Date(NOW.getTime() + 2 * HOUR), send);
      expect(sent).toHaveLength(1);
    });

    it("only counts what came after the last summary", async () => {
      await lead({ createdAt: new Date(NOW.getTime() - HOUR) });
      await sendDailyDigests(db, NOW, send);
      const next = new Date(NOW.getTime() + 25 * HOUR);
      await lead({ createdAt: new Date(NOW.getTime() + 24 * HOUR), name: "Late" });
      await sendDailyDigests(db, next, send);
      expect(sent).toHaveLength(2);
      expect(sent[1].text).toContain("1 new enquiry");
    });

    it("skips companies that are not verified", async () => {
      await lead({ createdAt: new Date(NOW.getTime() - HOUR) });
      await db.builder.update({ where: { id: builderId }, data: { status: "SUSPENDED" } });
      expect(await sendDailyDigests(db, NOW, send)).toEqual({ emails: 0 });
    });
  });

  describe("approval expiry", () => {
    const approval = (validTill: Date, extra: Record<string, unknown> = {}) =>
      db.projectApproval.create({
        data: { projectId, kind: "RERA", number: "RERA/1", validTill, ...extra },
      });

    it("warns at 30, 7 and 1 days, each only once", async () => {
      await approval(day(29));
      expect((await processApprovalExpiry(db, NOW, send)).warned).toBe(1);
      expect((await processApprovalExpiry(db, NOW, send)).warned).toBe(0);
      expect(
        (await processApprovalExpiry(db, new Date(NOW.getTime() + 10 * DAY), send)).warned,
      ).toBe(0);
      // 7 days left
      expect(
        (await processApprovalExpiry(db, new Date(NOW.getTime() + 23 * DAY), send)).warned,
      ).toBe(1);
      expect(
        (await processApprovalExpiry(db, new Date(NOW.getTime() + 24 * DAY), send)).warned,
      ).toBe(0);
      // tomorrow
      expect(
        (await processApprovalExpiry(db, new Date(NOW.getTime() + 28 * DAY), send)).warned,
      ).toBe(1);
      expect(sent).toHaveLength(3);
      expect(sent[0].subject).toContain("expires in 29 days");
      expect(sent[2].subject).toContain("tomorrow");
      expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({
        status: "LIVE",
      });
    });

    it("says nothing about an approval that is far from expiring", async () => {
      await approval(day(90));
      expect(await processApprovalExpiry(db, NOW, send)).toMatchObject({ warned: 0, paused: 0 });
    });

    it("keeps a project live through the last day of its approval", async () => {
      await approval(day(0)); // valid through today
      const result = await processApprovalExpiry(db, NOW, send);
      expect(result.paused).toBe(0);
      expect(result.warned).toBe(1);
      expect(sent[0].subject).toContain("end of today");
    });

    it("pauses a live project the day after its approval expires, and tells the builder why", async () => {
      await approval(day(-1));
      const result = await processApprovalExpiry(db, NOW, send);
      expect(result).toMatchObject({ paused: 1, pausedProjectIds: [projectId] });
      const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(project.status).toBe("PAUSED");
      expect(project.reviewNote).toContain("RERA approval expired on 2026-11-09");
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toContain("paused");
      const log = await db.auditLog.findFirstOrThrow({
        where: { action: "project.paused_expired_approval" },
      });
      expect(log).toMatchObject({ entityId: projectId, actorId: null });
    });

    it("pauses only once, however many approvals expired or times it runs", async () => {
      await approval(day(-1));
      await db.projectApproval.create({
        data: { projectId, kind: "TNCP", number: "T/1", validTill: day(-5) },
      });
      await Promise.all([
        processApprovalExpiry(db, NOW, send),
        processApprovalExpiry(db, NOW, send),
      ]);
      await processApprovalExpiry(db, NOW, send);
      expect(sent.filter((m) => m.subject.includes("paused"))).toHaveLength(1);
      expect(
        await db.auditLog.count({ where: { action: "project.paused_expired_approval" } }),
      ).toBe(1);
    });

    it("leaves projects that are not live alone", async () => {
      await db.project.update({ where: { id: projectId }, data: { status: "DRAFT" } });
      await approval(day(-3));
      expect(await processApprovalExpiry(db, NOW, send)).toMatchObject({ warned: 0, paused: 0 });
    });

    it("ignores approvals with no number or of other kinds", async () => {
      await db.projectApproval.create({
        data: { projectId, kind: "RERA", number: null, validTill: day(-3) },
      });
      await db.projectApproval.create({
        data: { projectId, kind: "BANK_LOAN", number: "B/1", validTill: day(-3) },
      });
      expect(await processApprovalExpiry(db, NOW, send)).toMatchObject({ warned: 0, paused: 0 });
    });
  });
});
