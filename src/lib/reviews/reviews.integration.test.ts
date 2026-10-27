import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  cleanText,
  displayNameFor,
  moderateReview,
  pendingReviews,
  publishedReviews,
  ratingSummary,
  replyToReview,
  reviewEligibility,
  submitReview,
} from "@/lib/reviews/service";

const url = process.env.TEST_DATABASE_URL;
const GOOD = "They answered every question and the plot was exactly as described.";

describe("text helpers", () => {
  it("shows only a first name and an initial", () => {
    expect(displayNameFor("Asha Kumar")).toBe("Asha K.");
    expect(displayNameFor("  asha   ")).toBe("asha");
    expect(displayNameFor("Asha Priya Kumar")).toBe("Asha K.");
    expect(displayNameFor(null)).toBe("A buyer");
    expect(displayNameFor("   ")).toBe("A buyer");
  });
  it("tidies what was typed", () => {
    expect(cleanText("  hello\r\n\r\n\r\n\r\nworld \u0000 ")).toBe("hello\n\nworld");
  });
});

describe.skipIf(!url)("reviews (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let buyerId: string;
  let adminId: string;
  let ownerId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    ownerId = (
      await db.user.create({
        data: { auth0Sub: "auth0|o", email: "owner@test.example", role: "BUILDER_OWNER" },
      })
    ).id;
    buyerId = (
      await db.user.create({
        data: { auth0Sub: "auth0|b", email: "buyer@test.example", name: "Asha Kumar" },
      })
    ).id;
    adminId = (
      await db.user.create({
        data: { auth0Sub: "auth0|a", email: "admin@test.example", role: "ADMIN" },
      })
    ).id;
    builderId = (
      await db.builder.create({
        data: { companyName: "Anand Realty", status: "VERIFIED", slug: "anand" },
      })
    ).id;
    await db.builderMember.create({ data: { builderId, userId: ownerId, role: "OWNER" } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const enquire = async (who = buyerId) => {
    const project = await db.project.upsert({
      where: { slug: "gv" },
      create: { builderId, name: "GV", slug: "gv", type: "PLOTTED", status: "LIVE" },
      update: {},
    });
    await db.lead.create({
      data: {
        projectId: project.id,
        builderId,
        buyerId: who,
        name: "A",
        mobile: "9876543210",
        email: "x@test.example",
        consentAt: new Date(),
        consentTermsVersion: "v1",
      },
    });
  };
  const submit = (over: Record<string, unknown> = {}) =>
    submitReview(db, {
      buyerId,
      buyerName: "Asha Kumar",
      builderId,
      rating: 5,
      body: GOOD,
      ...over,
    } as Parameters<typeof submitReview>[1]);

  describe("who may review", () => {
    it("needs an enquiry to that company", async () => {
      expect(await reviewEligibility(db, { buyerId, builderId })).toMatchObject({
        ok: false,
        code: "no_enquiry",
      });
      expect(await submit()).toMatchObject({ ok: false, code: "no_enquiry" });
      await enquire();
      expect(await reviewEligibility(db, { buyerId, builderId })).toMatchObject({
        ok: true,
        existing: null,
      });
    });

    it("is not open to the company's own people, an unverified company, or an unknown one", async () => {
      await enquire(ownerId);
      expect(
        await submitReview(db, {
          buyerId: ownerId,
          buyerName: "O",
          builderId,
          rating: 5,
          body: GOOD,
        }),
      ).toMatchObject({ ok: false, code: "own_company" });
      await db.builder.update({ where: { id: builderId }, data: { status: "SUSPENDED" } });
      expect(await reviewEligibility(db, { buyerId, builderId })).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await reviewEligibility(db, { buyerId, builderId: "nope" })).toMatchObject({
        ok: false,
        code: "not_found",
      });
    });
  });

  describe("writing", () => {
    beforeEach(async () => {
      await enquire();
    });

    it("saves a review as waiting, under a shortened name", async () => {
      const result = await submit();
      expect(result.ok && result.review).toMatchObject({
        status: "PENDING",
        rating: 5,
        displayName: "Asha K.",
        body: GOOD,
      });
    });

    it("refuses a bad rating and text that is too short or too long", async () => {
      for (const rating of [0, 6, 2.5, "x", null, undefined, NaN]) {
        expect(await submit({ rating }), String(rating)).toMatchObject({
          ok: false,
          code: "invalid",
        });
      }
      expect(await submit({ body: "too short" })).toMatchObject({ ok: false, code: "invalid" });
      expect(await submit({ body: "x".repeat(1001) })).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(await db.review.count()).toBe(0);
    });

    it("accepts the rating as text from a form", async () => {
      expect(await submit({ rating: "4" })).toMatchObject({ ok: true });
    });

    it("keeps one review per company: writing again edits it and sends it back to waiting", async () => {
      const first = await submit();
      if (!first.ok) throw new Error("setup");
      await moderateReview(db, { reviewId: first.review.id, adminId, decision: "publish" });
      await replyToReview(db, {
        builderId,
        reviewId: first.review.id,
        actorId: ownerId,
        text: "Thank you.",
      });
      const second = await submit({ rating: 3, body: `${GOOD} Update: price changed.` });
      expect(second.ok && second.review).toMatchObject({
        id: first.review.id,
        status: "PENDING",
        rating: 3,
        moderatedAt: null,
      });
      expect(await db.review.count()).toBe(1);
      expect(await ratingSummary(db, builderId)).toEqual({ average: null, count: 0 });
    });

    it("stores markup as plain text, untouched (it is escaped when shown)", async () => {
      const result = await submit({ body: `<script>alert(1)</script> ${GOOD}` });
      expect(result.ok && result.review.body).toContain("<script>alert(1)</script>");
    });
  });

  describe("moderation", () => {
    let reviewId: string;
    beforeEach(async () => {
      await enquire();
      const result = await submit();
      if (!result.ok) throw new Error("setup");
      reviewId = result.review.id;
    });

    it("lists what is waiting, and publishes it", async () => {
      expect((await pendingReviews(db)).map((r) => r.id)).toEqual([reviewId]);
      expect(await publishedReviews(db, builderId)).toEqual([]);
      const done = await moderateReview(db, { reviewId, adminId, decision: "publish" });
      expect(done.ok && done.review).toMatchObject({ status: "PUBLISHED", moderatedById: adminId });
      expect((await publishedReviews(db, builderId)).map((r) => r.id)).toEqual([reviewId]);
      expect(await pendingReviews(db)).toEqual([]);
      expect(await db.auditLog.count({ where: { action: "review.published" } })).toBe(1);
    });

    it("needs a real reason to reject, and shows nothing publicly afterwards", async () => {
      expect(
        await moderateReview(db, { reviewId, adminId, decision: "reject", reason: "no" }),
      ).toMatchObject({ ok: false });
      const done = await moderateReview(db, {
        reviewId,
        adminId,
        decision: "reject",
        reason: "Please remove the phone number.",
      });
      expect(done.ok && done.review).toMatchObject({
        status: "REJECTED",
        rejectReason: "Please remove the phone number.",
      });
      expect(await publishedReviews(db, builderId)).toEqual([]);
    });

    it("can take a published review down, and an unknown review is not found", async () => {
      await moderateReview(db, { reviewId, adminId, decision: "publish" });
      await moderateReview(db, {
        reviewId,
        adminId,
        decision: "reject",
        reason: "Contains a personal accusation.",
      });
      expect(await publishedReviews(db, builderId)).toEqual([]);
      expect(
        await moderateReview(db, { reviewId: "nope", adminId, decision: "publish" }),
      ).toMatchObject({ ok: false });
    });

    it("averages only published reviews", async () => {
      await moderateReview(db, { reviewId, adminId, decision: "publish" });
      const other = await db.user.create({
        data: { auth0Sub: "auth0|c", email: "c@test.example", name: "Ravi" },
      });
      await enquire(other.id);
      const second = await submitReview(db, {
        buyerId: other.id,
        buyerName: "Ravi",
        builderId,
        rating: 4,
        body: GOOD,
      });
      if (!second.ok) throw new Error("setup");
      expect(await ratingSummary(db, builderId)).toEqual({ average: 5, count: 1 });
      await moderateReview(db, { reviewId: second.review.id, adminId, decision: "publish" });
      expect(await ratingSummary(db, builderId)).toEqual({ average: 4.5, count: 2 });
    });
  });

  describe("the company's reply", () => {
    let reviewId: string;
    beforeEach(async () => {
      await enquire();
      const result = await submit();
      if (!result.ok) throw new Error("setup");
      reviewId = result.review.id;
    });
    const reply = (text: string, over: Record<string, unknown> = {}) =>
      replyToReview(db, {
        builderId,
        reviewId,
        actorId: ownerId,
        text,
        ...over,
      } as Parameters<typeof replyToReview>[1]);

    it("is possible only once the review is published", async () => {
      expect(await reply("Thank you for the kind words.")).toMatchObject({ ok: false });
      await moderateReview(db, { reviewId, adminId, decision: "publish" });
      expect(await reply("Thank you for the kind words.")).toEqual({ ok: true });
      expect((await publishedReviews(db, builderId))[0].reply).toBe(
        "Thank you for the kind words.",
      );
    });

    it("can be edited, but there is only ever one", async () => {
      await moderateReview(db, { reviewId, adminId, decision: "publish" });
      await reply("First answer.");
      await reply("Better answer.");
      expect((await db.review.findUniqueOrThrow({ where: { id: reviewId } })).reply).toBe(
        "Better answer.",
      );
    });

    it("is limited in length, and only for the company's own reviews", async () => {
      await moderateReview(db, { reviewId, adminId, decision: "publish" });
      expect(await reply("hi")).toMatchObject({ ok: false });
      expect(await reply("x".repeat(601))).toMatchObject({ ok: false });
      const other = await db.builder.create({ data: { companyName: "Other", status: "VERIFIED" } });
      expect(
        await reply("Not your review, but a long enough answer.", { builderId: other.id }),
      ).toMatchObject({ ok: false });
      expect((await db.review.findUniqueOrThrow({ where: { id: reviewId } })).reply).toBeNull();
    });
  });
});
