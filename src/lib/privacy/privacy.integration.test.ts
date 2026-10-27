import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { deleteBuyerAccount, exportUserData } from "@/lib/privacy/service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");

describe.skipIf(!url)("your data (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let buyerId: string;
  let builderId: string;
  let projectId: string;
  let plotId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.booking.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    buyerId = (
      await db.user.create({
        data: {
          auth0Sub: "auth0|b",
          email: "asha@test.example",
          name: "Asha Kumar",
          mobile: "9876543210",
          termsVersion: "v1",
        },
      })
    ).id;
    builderId = (
      await db.builder.create({ data: { companyName: "Anand Realty", status: "VERIFIED" } })
    ).id;
    projectId = (
      await db.project.create({
        data: { builderId, name: "Green Valley", slug: "gv", type: "PLOTTED", status: "LIVE" },
      })
    ).id;
    plotId = (
      await db.plot.create({
        data: { projectId, number: "A-1", sortKey: "a-00000001", sizeSqft: 1000 },
      })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const fill = async () => {
    await db.shortlist.create({ data: { userId: buyerId, projectId } });
    const lead = await db.lead.create({
      data: {
        projectId,
        builderId,
        buyerId,
        name: "Asha Kumar",
        mobile: "9876543210",
        email: "asha@test.example",
        message: "Is plot A-1 east facing?",
        consentAt: NOW,
        consentTermsVersion: "v1",
      },
    });
    await db.leadNote.create({
      data: { leadId: lead.id, authorId: buyerId, kind: "BUYER", text: "Is plot A-1 east facing?" },
    });
    await db.leadNote.create({
      data: {
        leadId: lead.id,
        authorId: null,
        kind: "BUILDER",
        text: "Internal: serious buyer, call twice.",
      },
    });
    await db.review.create({
      data: {
        builderId,
        buyerId,
        displayName: "Asha K.",
        rating: 5,
        body: "Very helpful team indeed.",
        status: "PUBLISHED",
      },
    });
    return lead;
  };
  const booking = (status: "HELD" | "PAID" | "REFUND_DUE" | "EXPIRED") =>
    db.booking.create({
      data: {
        plotId,
        plotNumber: "A-1",
        projectId,
        builderId,
        buyerId,
        buyerName: "Asha Kumar",
        buyerMobile: "9876543210",
        tokenPaise: 2_500_000,
        status,
        holdExpiresAt: NOW,
        provider: "test",
      },
    });

  describe("the copy of your data", () => {
    it("holds the person's own details and nothing a builder wrote about them", async () => {
      await fill();
      const data = await exportUserData(db, buyerId, NOW);
      expect(data?.account).toMatchObject({
        email: "asha@test.example",
        name: "Asha Kumar",
        mobile: "9876543210",
      });
      expect(data?.savedProjects.map((s) => s.project)).toEqual(["Green Valley"]);
      expect(data?.enquiries).toHaveLength(1);
      expect(data?.enquiries[0].yourMessages.map((m) => m.text)).toEqual([
        "Is plot A-1 east facing?",
      ]);
      expect(data?.reviews[0]).toMatchObject({ rating: 5, status: "published" });
      expect(JSON.stringify(data)).not.toContain("Internal: serious buyer");
    });
    it("includes bookings, and is null for an unknown person", async () => {
      await booking("EXPIRED");
      expect((await exportUserData(db, buyerId, NOW))?.bookings).toEqual([
        expect.objectContaining({ plot: "A-1", tokenRupees: 25_000, status: "expired" }),
      ]);
      expect(await exportUserData(db, "nope", NOW)).toBeNull();
    });
    it("never includes another person's data", async () => {
      await fill();
      const other = await db.user.create({
        data: { auth0Sub: "auth0|o", email: "other@test.example", name: "Other" },
      });
      const data = await exportUserData(db, other.id, NOW);
      expect(data?.enquiries).toEqual([]);
      expect(data?.savedProjects).toEqual([]);
      expect(JSON.stringify(data)).not.toContain("asha@test.example");
    });
  });

  describe("erasing an account", () => {
    it("removes the person's details, keeps the builder's lead without them, and frees the login", async () => {
      const lead = await fill();
      expect(await deleteBuyerAccount(db, buyerId, NOW)).toEqual({ ok: true });
      const user = await db.user.findUniqueOrThrow({ where: { id: buyerId } });
      expect(user).toMatchObject({ name: null, mobile: null, termsVersion: null });
      expect(user.email).toBe(`deleted-${buyerId}@deleted.invalid`);
      expect(user.auth0Sub).toBe(`deleted|${buyerId}`);
      expect(await db.shortlist.count({ where: { userId: buyerId } })).toBe(0);
      expect(await db.review.count({ where: { buyerId } })).toBe(0);
      const kept = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(kept).toMatchObject({
        name: "Deleted user",
        mobile: "0000000000",
        email: "deleted@deleted.invalid",
        message: null,
      });
      const notes = await db.leadNote.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: "asc" },
      });
      expect(notes.map((n) => n.text)).toEqual([
        "[removed at the buyer's request]",
        "Internal: serious buyer, call twice.",
      ]);
      expect(await db.auditLog.count({ where: { action: "account.deleted" } })).toBe(1);
      // the same email can sign up again as a fresh account
      await expect(
        db.user.create({ data: { auth0Sub: "auth0|b", email: "asha@test.example" } }),
      ).resolves.toBeTruthy();
    });

    it("gives up an unpaid hold, freeing the plot", async () => {
      await db.plot.update({ where: { id: plotId }, data: { status: "HELD" } });
      const held = await booking("HELD");
      expect(await deleteBuyerAccount(db, buyerId, NOW)).toEqual({ ok: true });
      expect((await db.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe(
        "CANCELLED",
      );
      expect((await db.plot.findUniqueOrThrow({ where: { id: plotId } })).status).toBe("AVAILABLE");
    });

    it("keeps a settled booking as a financial record with the contact details removed", async () => {
      const done = await booking("EXPIRED");
      await deleteBuyerAccount(db, buyerId, NOW);
      expect(await db.booking.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({
        buyerName: "Deleted user",
        buyerMobile: "0000000000",
        tokenPaise: 2_500_000,
      });
    });

    it("refuses while money is unsettled, changing nothing", async () => {
      await fill();
      await booking("PAID");
      expect(await deleteBuyerAccount(db, buyerId, NOW)).toMatchObject({
        ok: false,
        code: "money",
      });
      await db.booking.deleteMany();
      await booking("REFUND_DUE");
      expect(await deleteBuyerAccount(db, buyerId, NOW)).toMatchObject({
        ok: false,
        code: "money",
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: buyerId } })).email).toBe(
        "asha@test.example",
      );
      expect(await db.shortlist.count({ where: { userId: buyerId } })).toBe(1);
    });

    it("refuses staff and anyone in a company, and an unknown account", async () => {
      const admin = await db.user.create({
        data: { auth0Sub: "auth0|a", email: "admin@test.example", role: "ADMIN" },
      });
      expect(await deleteBuyerAccount(db, admin.id, NOW)).toMatchObject({
        ok: false,
        code: "staff",
      });
      const owner = await db.user.create({
        data: { auth0Sub: "auth0|ow", email: "owner@test.example", role: "BUILDER_OWNER" },
      });
      await db.builderMember.create({ data: { builderId, userId: owner.id, role: "OWNER" } });
      expect(await deleteBuyerAccount(db, owner.id, NOW)).toMatchObject({
        ok: false,
        code: "company",
      });
      expect(await deleteBuyerAccount(db, "nope", NOW)).toMatchObject({
        ok: false,
        code: "not_found",
      });
    });
  });
});
