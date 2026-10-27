import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { markOrderFailed, settleOrder } from "@/lib/billing/payments";
import { settleBooking } from "@/lib/booking/service";
import type { PaymentProvider } from "@/lib/billing/provider";
import type { Supplier } from "@/lib/billing/subscriptions";

// The gateway tells us a payment happened. We never take its word for the plan: the signature must
// check out, the amount must be the order's amount, and settling is idempotent, so the same event
// arriving twice (they retry), late or out of order does no harm. The answer's status tells the
// gateway what to do: 200 means "got it, do not resend", 400 "this is not a real message", 500 "try
// again later".

export type WebhookOutcome = {
  status: 200 | 400 | 500;
  body: { received: boolean; note?: string };
  /** For the caller: orders that were settled by this event, so pages can be refreshed. */
  settledOrderId?: string;
  /** A token payment that was settled by this event, and what became of it. */
  settledBookingId?: string;
  bookingOutcome?: "paid" | "refund_due";
};

type RazorpayEvent = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        created_at?: number;
        error_description?: string;
      };
    };
    order?: { entity?: { id?: string; amount_paid?: number } };
  };
};

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

export async function processWebhook(
  db: PrismaClient,
  provider: PaymentProvider,
  input: {
    rawBody: string;
    signature: string | null;
    /** The gateway's own id for the event (Razorpay sends it as a header). */
    eventId: string | null;
    supplier?: Supplier;
    now?: Date;
  },
): Promise<WebhookOutcome> {
  if (!provider.verifyWebhookSignature(input.rawBody, input.signature)) {
    return { status: 400, body: { received: false, note: "bad signature" } };
  }
  let event: RazorpayEvent;
  try {
    event = JSON.parse(input.rawBody) as RazorpayEvent;
  } catch {
    return { status: 400, body: { received: false, note: "not json" } };
  }

  const type = typeof event.event === "string" ? event.event.slice(0, 80) : "unknown";
  const payment = event.payload?.payment?.entity;
  const providerOrderId = payment?.order_id ?? event.payload?.order?.entity?.id ?? null;
  // Without the gateway's id, the body's own hash still tells a repeat from a new message.
  const eventId = input.eventId ?? createHash("sha256").update(input.rawBody).digest("hex");

  const seen = await db.paymentEvent.findUnique({
    where: { provider_eventId: { provider: provider.name, eventId } },
    select: { id: true },
  });
  if (seen) return { status: 200, body: { received: true, note: "already handled" } };

  let outcome: WebhookOutcome = { status: 200, body: { received: true } };
  try {
    if ((type === "payment.captured" || type === "order.paid") && providerOrderId) {
      if (!payment?.id || typeof payment.amount !== "number") {
        outcome = { status: 200, body: { received: true, note: "no payment details" } };
      } else {
        const settled = await settleOrder(db, {
          providerOrderId,
          providerPaymentId: payment.id,
          amountPaise: payment.amount,
          provider: provider.name,
          supplier: input.supplier,
          now: input.now,
        });
        if (settled.ok) {
          outcome = {
            status: 200,
            body: { received: true, note: settled.settledNow ? "settled" : "already settled" },
            ...(settled.settledNow ? { settledOrderId: settled.order.id } : {}),
          };
        } else if (settled.code === "not_found") {
          // Not a plan payment: it may be a token payment for a booking.
          const booking = await settleBooking(db, {
            providerOrderId,
            providerPaymentId: payment.id,
            amountPaise: payment.amount,
            provider: provider.name,
            paidAt: payment.created_at ? new Date(payment.created_at * 1000) : null,
            now: input.now,
          });
          outcome = booking.ok
            ? {
                status: 200,
                body: {
                  received: true,
                  note: booking.settledNow ? booking.outcome : "already settled",
                },
                ...(booking.settledNow && booking.outcome !== "already"
                  ? { settledBookingId: booking.booking.id, bookingOutcome: booking.outcome }
                  : {}),
              }
            : { status: 200, body: { received: true, note: booking.code } };
        } else {
          // A wrong amount will not get better by being resent.
          outcome = { status: 200, body: { received: true, note: settled.code } };
        }
      }
    } else if (type === "payment.failed" && providerOrderId) {
      await markOrderFailed(db, {
        providerOrderId,
        reason: payment?.error_description ?? "The payment failed.",
      });
    }
  } catch (error) {
    console.error("Could not process a payment event", error);
    return { status: 500, body: { received: false, note: "try again" } };
  }

  try {
    await db.paymentEvent.create({
      data: { provider: provider.name, eventId, type, providerOrderId },
    });
  } catch (error) {
    // The same event arriving at the same moment: the other one recorded it first.
    if (!isUniqueViolation(error)) throw error;
  }
  return outcome;
}
