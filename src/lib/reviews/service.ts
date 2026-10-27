import type { PrismaClient, Review } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";

// Reviews of builders. The rules, in one place:
//  - only a buyer who sent that company an enquiry may review it, once, and not their own company;
//  - a review waits for staff to publish it (or reject it with a reason); editing a review sends it
//    back to waiting, so a published review is always one that staff have read;
//  - the company may reply to a published review, once, and edit that reply;
//  - text is plain: it is stored as typed and always escaped when shown.

export const REVIEW_MIN = 20;
export const REVIEW_MAX = 1000;
export const REPLY_MIN = 5;
export const REPLY_MAX = 600;
export const REJECT_REASON_MIN = 10;

/** "Asha Kumar" becomes "Asha K."; nobody's full name is shown. */
export function displayNameFor(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A buyer";
  const first = parts[0].slice(0, 20);
  return parts.length > 1 ? `${first} ${[...parts.at(-1)!][0].toUpperCase()}.` : first;
}

/** Normalises what a person typed: trimmed, line endings and runs of blank lines tidied. */
export function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Eligibility =
  | { ok: true; existing: Review | null }
  | { ok: false; code: "no_enquiry" | "own_company" | "not_found"; message: string };

export async function reviewEligibility(
  db: PrismaClient,
  input: { buyerId: string; builderId: string },
): Promise<Eligibility> {
  const builder = await db.builder.findFirst({
    where: { id: input.builderId, status: "VERIFIED" },
    select: { id: true },
  });
  if (!builder) return { ok: false, code: "not_found", message: "That company was not found." };
  const own = await db.builderMember.findFirst({
    where: { builderId: input.builderId, userId: input.buyerId },
    select: { id: true },
  });
  if (own) {
    return { ok: false, code: "own_company", message: "You cannot review your own company." };
  }
  const enquiry = await db.lead.findFirst({
    where: { builderId: input.builderId, buyerId: input.buyerId },
    select: { id: true },
  });
  if (!enquiry) {
    return {
      ok: false,
      code: "no_enquiry",
      message: "You can review a company after you have sent it an enquiry.",
    };
  }
  const existing = await db.review.findUnique({
    where: { builderId_buyerId: { builderId: input.builderId, buyerId: input.buyerId } },
  });
  return { ok: true, existing };
}

export type SubmitResult =
  | { ok: true; review: Review }
  | { ok: false; code: "invalid" | "no_enquiry" | "own_company" | "not_found"; message: string };

/** Writes or rewrites the buyer's review. It always ends up waiting for staff. */
export async function submitReview(
  db: PrismaClient,
  input: {
    buyerId: string;
    buyerName: string | null;
    builderId: string;
    rating: unknown;
    body: string;
  },
): Promise<SubmitResult> {
  const rating = typeof input.rating === "string" ? Number(input.rating) : input.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: "invalid", message: "Choose a rating from 1 to 5 stars." };
  }
  const body = cleanText(input.body);
  if (body.length < REVIEW_MIN) {
    return {
      ok: false,
      code: "invalid",
      message: `Tell us a little more: at least ${REVIEW_MIN} characters.`,
    };
  }
  if (body.length > REVIEW_MAX) {
    return {
      ok: false,
      code: "invalid",
      message: `Please keep it under ${REVIEW_MAX} characters.`,
    };
  }
  const eligible = await reviewEligibility(db, input);
  if (!eligible.ok) return eligible;

  const data = {
    rating,
    body,
    displayName: displayNameFor(input.buyerName),
    status: "PENDING" as const,
    rejectReason: null,
    moderatedById: null,
    moderatedAt: null,
  };
  const review = await db.review.upsert({
    where: { builderId_buyerId: { builderId: input.builderId, buyerId: input.buyerId } },
    create: { builderId: input.builderId, buyerId: input.buyerId, ...data },
    update: data,
  });
  return { ok: true, review };
}

export type RatingSummary = { average: number | null; count: number };

export async function ratingSummary(db: PrismaClient, builderId: string): Promise<RatingSummary> {
  const result = await db.review.aggregate({
    where: { builderId, status: "PUBLISHED" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return {
    average: result._avg.rating === null ? null : Math.round(result._avg.rating * 10) / 10,
    count: result._count._all,
  };
}

export type PublicReview = Pick<
  Review,
  "id" | "displayName" | "rating" | "body" | "reply" | "repliedAt" | "createdAt"
>;

export async function publishedReviews(
  db: PrismaClient,
  builderId: string,
  take = 20,
): Promise<PublicReview[]> {
  return db.review.findMany({
    where: { builderId, status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      displayName: true,
      rating: true,
      body: true,
      reply: true,
      repliedAt: true,
      createdAt: true,
    },
  });
}

export type ModerationResult = { ok: true; review: Review } | { ok: false; message: string };

export async function moderateReview(
  db: PrismaClient,
  input: {
    reviewId: string;
    adminId: string;
    decision: "publish" | "reject";
    reason?: string;
    now?: Date;
  },
): Promise<ModerationResult> {
  const reason = cleanText(input.reason ?? "");
  if (input.decision === "reject" && reason.length < REJECT_REASON_MIN) {
    return {
      ok: false,
      message: `Give a reason of at least ${REJECT_REASON_MIN} characters, so the reviewer knows what to change.`,
    };
  }
  const now = input.now ?? new Date();
  const changed = await db.review.updateMany({
    where: { id: input.reviewId },
    data:
      input.decision === "publish"
        ? {
            status: "PUBLISHED",
            rejectReason: null,
            moderatedById: input.adminId,
            moderatedAt: now,
          }
        : {
            status: "REJECTED",
            rejectReason: reason.slice(0, 300),
            moderatedById: input.adminId,
            moderatedAt: now,
          },
  });
  if (changed.count !== 1) return { ok: false, message: "That review was not found." };
  await recordAudit(db, {
    actorId: input.adminId,
    action: input.decision === "publish" ? "review.published" : "review.rejected",
    entity: "Review",
    entityId: input.reviewId,
    meta: input.decision === "reject" ? { reason: reason.slice(0, 300) } : undefined,
  });
  return { ok: true, review: await db.review.findUniqueOrThrow({ where: { id: input.reviewId } }) };
}

export type ReplyResult = { ok: true } | { ok: false; message: string };

/** The company's reply to a published review of its own. One reply, which can be edited. */
export async function replyToReview(
  db: PrismaClient,
  input: { builderId: string; reviewId: string; actorId: string; text: string; now?: Date },
): Promise<ReplyResult> {
  const text = cleanText(input.text);
  if (text.length < REPLY_MIN || text.length > REPLY_MAX) {
    return { ok: false, message: `A reply is ${REPLY_MIN} to ${REPLY_MAX} characters.` };
  }
  const changed = await db.review.updateMany({
    where: { id: input.reviewId, builderId: input.builderId, status: "PUBLISHED" },
    data: { reply: text, repliedAt: input.now ?? new Date(), repliedById: input.actorId },
  });
  if (changed.count !== 1) return { ok: false, message: "That review was not found." };
  await recordAudit(db, {
    actorId: input.actorId,
    action: "review.replied",
    entity: "Review",
    entityId: input.reviewId,
  });
  return { ok: true };
}

/** Reviews waiting for staff, oldest first. */
export async function pendingReviews(db: PrismaClient, take = 50) {
  return db.review.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take,
    include: { builder: { select: { id: true, companyName: true } } },
  });
}
