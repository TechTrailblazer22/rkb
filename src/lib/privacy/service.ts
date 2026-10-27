import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";

// A person's rights over their own data (India's DPDP Act): to get a copy of it, and to have it
// erased. Erasure here means anonymising: the account can no longer be reached and carries no
// personal details, while records other people legitimately need (a builder's leads, money that
// moved) stay, with the person's details removed.

export type UserExport = {
  generatedAt: string;
  account: {
    email: string;
    name: string | null;
    mobile: string | null;
    createdAt: string;
    acceptedTermsVersion: string | null;
  };
  savedProjects: { project: string; savedAt: string }[];
  enquiries: {
    project: string;
    company: string | null;
    status: string;
    plot: string | null;
    sentAt: string;
    yourMessages: { at: string; text: string }[];
  }[];
  reviews: { company: string | null; rating: number; text: string; status: string; at: string }[];
  bookings: {
    project: string;
    plot: string;
    tokenRupees: number;
    status: string;
    at: string;
  }[];
};

/** Everything we hold about this person, as plain data. Never includes what a builder wrote about them. */
export async function exportUserData(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<UserExport | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      mobile: true,
      createdAt: true,
      termsVersion: true,
      shortlist: {
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, project: { select: { name: true } } },
      },
      leads: {
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          preferredPlot: true,
          createdAt: true,
          project: { select: { name: true } },
          builder: { select: { companyName: true } },
          notes: {
            where: { kind: "BUYER", authorId: userId },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true, text: true },
          },
        },
      },
      reviews: {
        orderBy: { createdAt: "desc" },
        select: {
          rating: true,
          body: true,
          status: true,
          createdAt: true,
          builder: { select: { companyName: true } },
        },
      },
      bookings: {
        orderBy: { createdAt: "desc" },
        select: {
          plotNumber: true,
          tokenPaise: true,
          status: true,
          createdAt: true,
          project: { select: { name: true } },
        },
      },
    },
  });
  if (!user) return null;
  return {
    generatedAt: now.toISOString(),
    account: {
      email: user.email,
      name: user.name,
      mobile: user.mobile,
      createdAt: user.createdAt.toISOString(),
      acceptedTermsVersion: user.termsVersion,
    },
    savedProjects: user.shortlist.map((s) => ({
      project: s.project.name,
      savedAt: s.createdAt.toISOString(),
    })),
    enquiries: user.leads.map((l) => ({
      project: l.project.name,
      company: l.builder.companyName,
      status: l.status,
      plot: l.preferredPlot,
      sentAt: l.createdAt.toISOString(),
      yourMessages: l.notes.map((n) => ({ at: n.createdAt.toISOString(), text: n.text })),
    })),
    reviews: user.reviews.map((r) => ({
      company: r.builder.companyName,
      rating: r.rating,
      text: r.body,
      status: r.status.toLowerCase(),
      at: r.createdAt.toISOString(),
    })),
    bookings: user.bookings.map((b) => ({
      project: b.project.name,
      plot: b.plotNumber,
      tokenRupees: b.tokenPaise / 100,
      status: b.status.toLowerCase(),
      at: b.createdAt.toISOString(),
    })),
  };
}

export type DeleteResult =
  { ok: true } | { ok: false; code: "not_found" | "company" | "staff" | "money"; message: string };

/**
 * Anonymises a buyer account. Refused for staff and for anyone in a company (company records are
 * business records, handled by us on request), and while a booking's money is unsettled (a paid
 * token, or one waiting to be refunded): those must be settled first.
 */
export async function deleteBuyerAccount(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<DeleteResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, builderMemberships: { select: { id: true } } },
  });
  if (!user) return { ok: false, code: "not_found", message: "That account was not found." };
  if (user.role === "ADMIN") {
    return { ok: false, code: "staff", message: "Staff accounts cannot be deleted here." };
  }
  if (user.builderMemberships.length > 0) {
    return {
      ok: false,
      code: "company",
      message:
        "Your login is part of a company account. Company records are kept as business records: please contact us to have them handled.",
    };
  }

  return db.$transaction(async (tx): Promise<DeleteResult> => {
    // Money in flight blocks erasure until it is settled; an unpaid hold is simply given up.
    const unsettled = await tx.booking.count({
      where: { buyerId: userId, status: { in: ["PAID", "REFUND_DUE"] } },
    });
    if (unsettled > 0) {
      return {
        ok: false,
        code: "money",
        message:
          "You have a booking with a token that has been paid or is waiting to be refunded. Please settle it with the builder (or ask us to refund it) before deleting your account.",
      };
    }
    const holds = await tx.booking.findMany({
      where: { buyerId: userId, status: "HELD" },
      select: { id: true, plotId: true },
    });
    for (const hold of holds) {
      await tx.booking.update({ where: { id: hold.id }, data: { status: "CANCELLED" } });
      if (hold.plotId) {
        await tx.plot.updateMany({
          where: { id: hold.plotId, status: "HELD" },
          data: { status: "AVAILABLE" },
        });
      }
    }

    await tx.shortlist.deleteMany({ where: { userId } });
    await tx.review.deleteMany({ where: { buyerId: userId } });
    // Builders keep their leads (their own business record), without the person's details.
    await tx.lead.updateMany({
      where: { buyerId: userId },
      data: {
        name: "Deleted user",
        mobile: "0000000000",
        email: "deleted@deleted.invalid",
        message: null,
      },
    });
    await tx.leadNote.updateMany({
      where: { authorId: userId, kind: "BUYER" },
      data: { text: "[removed at the buyer's request]" },
    });
    // Bookings are financial records: kept, with the person's contact details removed.
    await tx.booking.updateMany({
      where: { buyerId: userId },
      data: { buyerName: "Deleted user", buyerMobile: "0000000000" },
    });
    // The login row stays (other records point to it) but can no longer be used or identified: the
    // address and the Auth0 identity are replaced, so signing in again starts a fresh, empty account.
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.invalid`,
        auth0Sub: `deleted|${userId}`,
        name: null,
        mobile: null,
        termsVersion: null,
      },
    });
    await recordAudit(tx, {
      actorId: userId,
      action: "account.deleted",
      entity: "User",
      entityId: userId,
      meta: { at: now.toISOString() },
    });
    return { ok: true };
  });
}
