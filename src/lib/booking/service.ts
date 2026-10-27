import type { Booking, Prisma, PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import type { PaymentProvider } from "@/lib/billing/provider";
import { type BookingConfig, bookingAvailability } from "@/lib/booking/config";

// Online token booking: a buyer holds an available plot for a few minutes, pays the project's token
// through the gateway, and the plot becomes Booked. The rules that keep money and plots in step:
//
//  - The plot row is locked (SELECT ... FOR UPDATE) whenever a hold, a release, a payment or a
//    refund touches it, so two buyers can never both hold one plot, and a payment and an expiry can
//    never both decide its fate. Plot first, then booking, always, so locks cannot deadlock.
//  - Only an AVAILABLE plot can be held. The plot's own status is the source of truth: HELD while
//    the token is being paid, BOOKED once it is paid.
//  - A payment is settled at most once, and only for exactly the token amount.
//  - A payment that cannot be honoured (it came after the hold ended, or the plot went elsewhere) is
//    never silently kept: the booking is marked REFUND_DUE for staff or the company to refund.
//  - Every expired hold is released, when the plot is next asked for and by the scheduler.

type Tx = Prisma.TransactionClient;

const lockPlot = (tx: Tx, plotId: string) =>
  tx.$queryRaw`SELECT "id" FROM "Plot" WHERE "id" = ${plotId} FOR UPDATE`;

const MIN = 60_000;

async function setPlotStatus(
  tx: Tx,
  plot: { id: string; number: string; projectId: string; status: string },
  to: "AVAILABLE" | "HELD" | "BOOKED",
  via: string,
  actorId: string | null,
) {
  if (plot.status === to) return;
  await tx.plot.update({ where: { id: plot.id }, data: { status: to } });
  await tx.plotStatusLog.create({
    data: {
      plotId: plot.id,
      plotNumber: plot.number,
      projectId: plot.projectId,
      fromStatus: plot.status as "AVAILABLE" | "HELD" | "BOOKED" | "SOLD",
      toStatus: to,
      actorId,
      via,
    },
  });
}

export type HoldResult =
  | { ok: true; booking: Booking }
  | {
      ok: false;
      code: "unavailable" | "not_bookable" | "already_holding" | "gateway";
      message: string;
      /** For "already_holding": the booking the buyer can carry on with. */
      existingBookingId?: string;
    };

/**
 * Holds a plot for the buyer and opens the payment for its token. If the gateway cannot be reached
 * the hold is released at once, so the plot is never stuck.
 */
export async function holdPlot(
  db: PrismaClient,
  input: {
    plotId: string;
    buyer: { id: string; name: string; mobile: string };
    config: BookingConfig;
    provider: PaymentProvider | null;
    now?: Date;
  },
): Promise<HoldResult> {
  const now = input.now ?? new Date();
  const plot = await db.plot.findUnique({
    where: { id: input.plotId },
    select: {
      id: true,
      number: true,
      projectId: true,
      project: {
        select: {
          status: true,
          tokenAmount: true,
          builderId: true,
          builder: { select: { status: true, payoutAccountId: true } },
        },
      },
    },
  });
  if (!plot) return { ok: false, code: "unavailable", message: "That plot was not found." };

  const availability = bookingAvailability({
    config: input.config,
    paymentsConfigured: input.provider !== null,
    projectLive: plot.project.status === "LIVE",
    builderVerified: plot.project.builder.status === "VERIFIED",
    payoutAccountId: plot.project.builder.payoutAccountId,
    tokenRupees: plot.project.tokenAmount,
  });
  if (!availability.available) {
    return { ok: false, code: "not_bookable", message: availability.reason };
  }
  // A person cannot book a plot of the company they work for (the money would go round in a circle,
  // and a booking could be used to fake demand).
  const insider = await db.builderMember.findFirst({
    where: { builderId: plot.project.builderId, userId: input.buyer.id },
    select: { id: true },
  });
  if (insider) {
    return {
      ok: false,
      code: "not_bookable",
      message: "You cannot book a plot of your own company.",
    };
  }

  const held = await db.$transaction(async (tx): Promise<HoldResult> => {
    await lockPlot(tx, plot.id);
    await releaseHoldsOnPlot(tx, plot.id, now);

    const fresh = await tx.plot.findUniqueOrThrow({
      where: { id: plot.id },
      select: { id: true, number: true, projectId: true, status: true },
    });
    if (fresh.status !== "AVAILABLE") {
      return {
        ok: false,
        code: "unavailable",
        message: "Sorry, that plot is no longer available. It may have just been taken.",
      };
    }
    // One plot on hold at a time per buyer, so no one can sit on many plots.
    const mine = await tx.booking.findFirst({
      where: { buyerId: input.buyer.id, status: "HELD", holdExpiresAt: { gt: now } },
      select: { id: true },
    });
    if (mine) {
      return {
        ok: false,
        code: "already_holding",
        message: "You already have a plot on hold. Finish or cancel that booking first.",
        existingBookingId: mine.id,
      };
    }
    const booking = await tx.booking.create({
      data: {
        plotId: fresh.id,
        plotNumber: fresh.number,
        projectId: fresh.projectId,
        builderId: plot.project.builderId,
        buyerId: input.buyer.id,
        buyerName: input.buyer.name,
        buyerMobile: input.buyer.mobile,
        tokenPaise: availability.tokenPaise,
        holdExpiresAt: new Date(now.getTime() + input.config.holdMinutes * MIN),
        provider: input.provider!.name,
        createdAt: now,
      },
    });
    await setPlotStatus(tx, fresh, "HELD", "booking_hold", input.buyer.id);
    await recordAudit(tx, {
      actorId: input.buyer.id,
      action: "booking.held",
      entity: "Project",
      entityId: fresh.projectId,
      meta: { bookingId: booking.id, plot: fresh.number },
    });
    return { ok: true, booking };
  });
  if (!held.ok) return held;

  try {
    const order = await input.provider!.createOrder({
      amountPaise: held.booking.tokenPaise,
      receipt: held.booking.id,
      notes: { bookingId: held.booking.id, plot: plot.number },
      transfer: {
        accountId: plot.project.builder.payoutAccountId!,
        amountPaise: held.booking.tokenPaise,
      },
    });
    const saved = await db.booking.update({
      where: { id: held.booking.id },
      data: { providerOrderId: order.providerOrderId },
    });
    return { ok: true, booking: saved };
  } catch (error) {
    console.error("Could not create the booking payment", error);
    await cancelHold(db, {
      bookingId: held.booking.id,
      buyerId: input.buyer.id,
      now,
      reason: "gateway",
    });
    return {
      ok: false,
      code: "gateway",
      message:
        "The payment service could not be reached. Nothing was charged and the plot is free again.",
    };
  }
}

/** Ends the holds on a plot that have run out (inside the caller's transaction, plot already locked). */
async function releaseHoldsOnPlot(tx: Tx, plotId: string, now: Date) {
  const stale = await tx.booking.findMany({
    where: { plotId, status: "HELD", holdExpiresAt: { lte: now } },
    select: { id: true },
  });
  if (stale.length === 0) return;
  await tx.booking.updateMany({
    where: { id: { in: stale.map((b) => b.id) }, status: "HELD" },
    data: { status: "EXPIRED" },
  });
  const plot = await tx.plot.findUniqueOrThrow({
    where: { id: plotId },
    select: { id: true, number: true, projectId: true, status: true },
  });
  const stillHeld = await tx.booking.count({
    where: { plotId, status: "HELD", holdExpiresAt: { gt: now } },
  });
  if (plot.status === "HELD" && stillHeld === 0) {
    await setPlotStatus(tx, plot, "AVAILABLE", "booking_expired", null);
  }
}

/** The buyer gives up a hold (or it is abandoned at once because the gateway failed). */
export async function cancelHold(
  db: PrismaClient,
  input: { bookingId: string; buyerId: string; now?: Date; reason?: "gateway" | "buyer" },
): Promise<boolean> {
  const booking = await db.booking.findFirst({
    where: { id: input.bookingId, buyerId: input.buyerId },
    select: { id: true, plotId: true },
  });
  if (!booking?.plotId) return false;
  return db.$transaction(async (tx) => {
    await lockPlot(tx, booking.plotId!);
    const claimed = await tx.booking.updateMany({
      where: { id: booking.id, status: "HELD" },
      data: {
        status: "CANCELLED",
        note: input.reason === "gateway" ? "The gateway could not take the payment." : null,
      },
    });
    if (claimed.count !== 1) return false;
    const plot = await tx.plot.findUniqueOrThrow({
      where: { id: booking.plotId! },
      select: { id: true, number: true, projectId: true, status: true },
    });
    if (plot.status === "HELD") {
      await setPlotStatus(tx, plot, "AVAILABLE", "booking_cancelled", input.buyerId);
    }
    return true;
  });
}

/** Releases every hold that has run out, for the scheduler. Safe to run twice, or at once. */
export async function releaseExpiredHolds(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ released: number }> {
  const stale = await db.booking.findMany({
    where: { status: "HELD", holdExpiresAt: { lte: now } },
    select: { plotId: true },
    distinct: ["plotId"],
    take: 500,
  });
  let released = 0;
  for (const { plotId } of stale) {
    if (!plotId) continue;
    released += await db.$transaction(async (tx) => {
      await lockPlot(tx, plotId);
      const before = await tx.booking.count({
        where: { plotId, status: "HELD", holdExpiresAt: { lte: now } },
      });
      await releaseHoldsOnPlot(tx, plotId, now);
      return before;
    });
  }
  return { released };
}

export type SettleBookingResult =
  | { ok: true; settledNow: boolean; booking: Booking; outcome: "paid" | "refund_due" | "already" }
  | { ok: false; code: "not_found" | "amount_mismatch" | "wrong_gateway"; message: string };

/**
 * Applies a token payment. Idempotent, and safe against the webhook and the return page arriving at
 * once. `paidAt` is when the gateway says the buyer paid; a payment made before the hold ran out is
 * honoured even if we hear about it afterwards, as long as the plot is still free for this buyer.
 */
export async function settleBooking(
  db: PrismaClient,
  input: {
    bookingId?: string;
    providerOrderId?: string;
    providerPaymentId: string;
    amountPaise: number;
    provider: "razorpay" | "test";
    paidAt?: Date | null;
    now?: Date;
  },
): Promise<SettleBookingResult> {
  const now = input.now ?? new Date();
  const found = await db.booking.findFirst({
    where: input.bookingId
      ? { id: input.bookingId }
      : { providerOrderId: input.providerOrderId ?? "__none__" },
    select: { id: true, plotId: true },
  });
  if (!found) return { ok: false, code: "not_found", message: "No such booking." };

  return db.$transaction(async (tx): Promise<SettleBookingResult> => {
    // Plot first, then booking (the same order as a hold), so the two can never wait on each other.
    if (found.plotId) await lockPlot(tx, found.plotId);
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${found.id} FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.id } });

    if (booking.status === "PAID" || booking.status === "REFUNDED") {
      return { ok: true, settledNow: false, booking, outcome: "already" };
    }
    if (booking.provider !== input.provider) {
      return {
        ok: false,
        code: "wrong_gateway",
        message: "That payment does not belong to this gateway.",
      };
    }
    if (input.amountPaise !== booking.tokenPaise) {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          note: `Amount mismatch: expected ${booking.tokenPaise} paise, gateway reported ${input.amountPaise}.`,
        },
      });
      await recordAudit(tx, {
        actorId: null,
        action: "booking.amount_mismatch",
        entity: "Project",
        entityId: booking.projectId,
        meta: { bookingId: booking.id, expected: booking.tokenPaise, reported: input.amountPaise },
      });
      return {
        ok: false,
        code: "amount_mismatch",
        message: "The amount paid does not match the booking.",
      };
    }

    const plot = booking.plotId
      ? await tx.plot.findUnique({
          where: { id: booking.plotId },
          select: { id: true, number: true, projectId: true, status: true },
        })
      : null;
    const paidInTime = (input.paidAt ?? now).getTime() <= booking.holdExpiresAt.getTime();
    // The plot can be given to this buyer if it is free, or held with no other live hold on it (the
    // hold being this buyer's own, or one that ran out and was released).
    let plotFree = false;
    if (plot?.status === "AVAILABLE") plotFree = true;
    else if (plot?.status === "HELD") {
      const otherHold = await tx.booking.count({
        where: {
          plotId: plot.id,
          status: "HELD",
          id: { not: booking.id },
          holdExpiresAt: { gt: now },
        },
      });
      plotFree = otherHold === 0;
    }
    const honour =
      paidInTime && plotFree && (booking.status === "HELD" || booking.status === "EXPIRED");

    if (!honour) {
      const reason = !paidInTime
        ? "The payment arrived after the hold ended."
        : "The plot is no longer available to this buyer.";
      const flagged = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "REFUND_DUE",
          providerPaymentId: input.providerPaymentId,
          paidAt: input.paidAt ?? now,
          note: reason,
        },
      });
      // A plot still shown as held for this buyer goes back on sale: nobody will be paying for it.
      if (plot?.status === "HELD") {
        const otherHold = await tx.booking.count({
          where: {
            plotId: plot.id,
            status: "HELD",
            id: { not: booking.id },
            holdExpiresAt: { gt: now },
          },
        });
        if (otherHold === 0) await setPlotStatus(tx, plot, "AVAILABLE", "booking_refund_due", null);
      }
      await recordAudit(tx, {
        actorId: null,
        action: "booking.refund_due",
        entity: "Project",
        entityId: booking.projectId,
        meta: { bookingId: booking.id, reason },
      });
      return { ok: true, settledNow: true, booking: flagged, outcome: "refund_due" };
    }

    if (plot) await setPlotStatus(tx, plot, "BOOKED", "booking_paid", booking.buyerId);
    const paid = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "PAID",
        providerPaymentId: input.providerPaymentId,
        paidAt: input.paidAt ?? now,
        note: null,
      },
    });
    // The company sees the buyer in its leads, already marked Booked.
    const open = await tx.lead.findFirst({
      where: {
        builderId: booking.builderId,
        projectId: booking.projectId,
        buyerId: booking.buyerId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (open) {
      await tx.lead.update({
        where: { id: open.id },
        data: { status: "BOOKED", preferredPlot: booking.plotNumber, seenAt: null },
      });
    } else {
      const buyer = await tx.user.findUnique({
        where: { id: booking.buyerId },
        select: { email: true },
      });
      if (buyer) {
        await tx.lead.create({
          data: {
            projectId: booking.projectId,
            builderId: booking.builderId,
            buyerId: booking.buyerId,
            name: booking.buyerName,
            mobile: booking.buyerMobile,
            email: buyer.email,
            preferredPlot: booking.plotNumber,
            message: "Booked online with a token payment.",
            source: "online_booking",
            status: "BOOKED",
            consentAt: now,
            consentTermsVersion: "online-booking",
            createdAt: now,
          },
        });
      }
    }
    await recordAudit(tx, {
      actorId: booking.buyerId,
      action: "booking.paid",
      entity: "Project",
      entityId: booking.projectId,
      meta: { bookingId: booking.id, plot: booking.plotNumber, tokenPaise: booking.tokenPaise },
    });
    return { ok: true, settledNow: true, booking: paid, outcome: "paid" };
  });
}

export type RefundBookingResult =
  { ok: true; gatewayRefundId: string | null; booking: Booking } | { ok: false; message: string };

/**
 * Refunds a token (a paid booking, or one flagged REFUND_DUE) through the gateway, which also takes
 * the money back from the company's linked account. The plot goes back on sale only if it is still
 * Booked (never if the company has since marked it Sold). `builderId` limits a company to its own.
 */
export async function refundBooking(
  db: PrismaClient,
  input: {
    bookingId: string;
    actorId: string;
    builderId?: string;
    note: string;
    provider: PaymentProvider | null;
    now?: Date;
  },
): Promise<RefundBookingResult> {
  const now = input.now ?? new Date();
  const found = await db.booking.findFirst({
    where: { id: input.bookingId, ...(input.builderId ? { builderId: input.builderId } : {}) },
    select: { id: true, plotId: true },
  });
  if (!found) return { ok: false, message: "That booking was not found." };

  // What the booking was before, so a failed gateway refund can put it back exactly.
  const claim = await db.$transaction(async (tx) => {
    if (found.plotId) await lockPlot(tx, found.plotId);
    const before = await tx.booking.findUnique({
      where: { id: found.id },
      select: { status: true, note: true },
    });
    const taken = await tx.booking.updateMany({
      where: { id: found.id, status: { in: ["PAID", "REFUND_DUE"] } },
      data: { status: "REFUNDED", refundedAt: now, note: input.note },
    });
    if (taken.count !== 1 || !before) return null;
    return { before, booking: await tx.booking.findUniqueOrThrow({ where: { id: found.id } }) };
  });
  if (!claim) {
    return {
      ok: false,
      message: "That booking cannot be refunded (it is not paid, or was already refunded).",
    };
  }
  const claimed = claim.booking;

  const restore = async () => {
    await db.booking.updateMany({
      where: { id: claimed.id, status: "REFUNDED" },
      data: { status: claim.before.status, note: claim.before.note, refundedAt: null },
    });
  };
  let gatewayRefundId: string | null = null;
  if (claimed.providerPaymentId) {
    if (!input.provider || input.provider.name !== claimed.provider) {
      await restore();
      return {
        ok: false,
        message: "The gateway this was paid through is not set up, so it cannot be refunded here.",
      };
    }
    try {
      gatewayRefundId = (
        await input.provider.refund({
          paymentId: claimed.providerPaymentId,
          amountPaise: claimed.tokenPaise,
          reverseTransfers: true,
        })
      ).refundId;
    } catch (error) {
      console.error("Gateway refund of a booking failed", error);
      await restore();
      return {
        ok: false,
        message: "The gateway could not refund the payment. Nothing was changed.",
      };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: claimed.id }, data: { refundId: gatewayRefundId } });
    if (claimed.plotId) {
      await lockPlot(tx, claimed.plotId);
      const plot = await tx.plot.findUnique({
        where: { id: claimed.plotId },
        select: { id: true, number: true, projectId: true, status: true },
      });
      // Back on sale only if it is still Booked because of this booking.
      if (plot && plot.status === "BOOKED") {
        await setPlotStatus(tx, plot, "AVAILABLE", "booking_refunded", input.actorId);
      }
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "booking.refunded",
      entity: "Project",
      entityId: claimed.projectId,
      meta: { bookingId: claimed.id, gatewayRefundId, note: input.note },
    });
  });
  return {
    ok: true,
    gatewayRefundId,
    booking: await db.booking.findUniqueOrThrow({ where: { id: claimed.id } }),
  };
}

export type Reconciliation = {
  /** Paid bookings whose plot is not Booked or Sold (money taken, plot not secured). */
  paidButPlotFree: { bookingId: string; plot: string }[];
  /** Plots shown as held with no hold behind them (a plot nobody can buy). */
  heldWithoutBooking: { plotId: string; plot: string }[];
  /** Holds that ran out but were not released yet. */
  staleHolds: { bookingId: string; plot: string }[];
  /** Money we hold that must be returned. */
  refundDue: { bookingId: string; plot: string; reason: string | null }[];
};

/** A daily check that payments and plots agree. Read only: it reports, staff decide. */
export async function reconcileBookings(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<Reconciliation> {
  const [paid, held, stale, due] = await Promise.all([
    db.booking.findMany({
      where: { status: "PAID", plot: { status: { in: ["AVAILABLE", "HELD"] } } },
      select: { id: true, plotNumber: true },
      take: 200,
    }),
    db.plot.findMany({
      where: { status: "HELD", bookings: { none: { status: "HELD" } } },
      select: { id: true, number: true },
      take: 200,
    }),
    db.booking.findMany({
      where: { status: "HELD", holdExpiresAt: { lte: new Date(now.getTime() - 10 * MIN) } },
      select: { id: true, plotNumber: true },
      take: 200,
    }),
    db.booking.findMany({
      where: { status: "REFUND_DUE" },
      select: { id: true, plotNumber: true, note: true },
      take: 200,
    }),
  ]);
  return {
    paidButPlotFree: paid.map((b) => ({ bookingId: b.id, plot: b.plotNumber })),
    heldWithoutBooking: held.map((p) => ({ plotId: p.id, plot: p.number })),
    staleHolds: stale.map((b) => ({ bookingId: b.id, plot: b.plotNumber })),
    refundDue: due.map((b) => ({ bookingId: b.id, plot: b.plotNumber, reason: b.note })),
  };
}

export const hasProblems = (r: Reconciliation) =>
  r.paidButPlotFree.length +
    r.heldWithoutBooking.length +
    r.staleHolds.length +
    r.refundDue.length >
  0;
