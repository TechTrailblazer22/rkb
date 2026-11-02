import { afterSettled } from "@/lib/billing/after-settle";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { afterBookingChange } from "@/lib/booking/after";
import { processWebhook } from "@/lib/billing/webhook";
import { readTextBody } from "@/lib/body";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

// Where the payment gateway tells us a payment happened. Nothing here trusts the caller: the
// signature is checked against the raw body before anything is read (see lib/billing/webhook.ts),
// and the work is idempotent, so a retry or a replay does no harm.
export async function POST(request: Request) {
  let provider;
  try {
    provider = providerFor(billingConfig());
  } catch (error) {
    console.error("Billing is misconfigured", error);
    return Response.json({ received: false }, { status: 503 });
  }
  if (!provider) return Response.json({ received: false }, { status: 503 });

  // Real events are a few kilobytes. The limit is enforced while reading, so a body sent in chunks
  // (no Content-Length) or one that understates its size cannot get past it.
  const body = await readTextBody(request, MAX_WEBHOOK_BYTES);
  if (body.status === "too-large") return Response.json({ received: false }, { status: 413 });
  if (body.status !== "ok") return Response.json({ received: false }, { status: 400 });
  const rawBody = body.value;
  const db = getDb();
  const outcome = await processWebhook(db, provider, {
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
    eventId: request.headers.get("x-razorpay-event-id"),
  });
  if (outcome.settledOrderId) await afterSettled(db, outcome.settledOrderId);
  // A token payment: tell the buyer and the company (or staff, if it must be refunded).
  if (outcome.settledBookingId && outcome.bookingOutcome) {
    await afterBookingChange(db, outcome.settledBookingId, outcome.bookingOutcome);
  }
  return Response.json(outcome.body, { status: outcome.status });
}
