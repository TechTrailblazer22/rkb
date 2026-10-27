"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { billingConfig, providerFor, type PaymentProvider } from "@/lib/billing/provider";
import { afterBookingChange } from "@/lib/booking/after";
import { bookingConfig } from "@/lib/booking/config";
import { cancelHold, holdPlot, settleBooking } from "@/lib/booking/service";
import { getDb } from "@/lib/db";
import { createLimiter } from "@/lib/rate-limit";
import { normalizeMobile } from "@/lib/validation/identity";

// Every action here is the buyer's own: the booking must belong to the logged-in buyer, and the
// forms carry only ids and what the buyer typed. Money rules are in lib/booking/service.ts.

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

// Holding plots is limited per buyer, so nobody can churn plots in and out of being held.
const holdLimiter = createLimiter({ max: 20, windowMs: 3_600_000 });

function gateway(): PaymentProvider | null {
  try {
    return providerFor(billingConfig());
  } catch (error) {
    console.error("Billing is misconfigured", error);
    return null;
  }
}

/** The buyer confirms the plot and the token, and the plot is held for them. */
export async function startBooking(formData: FormData) {
  const plotId = text(formData, "plotId");
  const here = `/account/book/${encodeURIComponent(plotId)}`;
  const buyer = await requireUser({ returnTo: here, roles: ["BUYER"] });
  const fail = (message: string): never => redirect(`${here}?error=${encodeURIComponent(message)}`);

  if (holdLimiter.hit(buyer.id))
    fail("You have tried a lot of bookings in the last hour. Please try again later.");
  const name = text(formData, "name").trim().slice(0, 80);
  const mobile = normalizeMobile(text(formData, "mobile"));
  if (name.length < 2) fail("Please enter your name.");
  if (!mobile) fail("Enter a valid 10 digit Indian mobile number.");
  if (formData.get("agree") !== "on")
    fail("Please confirm that you have read and agree to the booking terms.");

  const result = await holdPlot(getDb(), {
    plotId,
    buyer: { id: buyer.id, name, mobile: mobile! },
    config: bookingConfig(),
    provider: gateway(),
  });
  if (!result.ok) {
    if (result.code === "already_holding" && result.existingBookingId) {
      redirect(`/account/bookings/${result.existingBookingId}`);
    }
    fail(result.message);
  }
  if (result.ok) {
    await getDb().user.update({ where: { id: buyer.id }, data: { mobile: mobile! } });
    redirect(`/account/bookings/${result.booking.id}`);
  }
}

export type BookingConfirmation = { ok: true } | { ok: false; message: string };

async function ownBooking(bookingId: string, buyerId: string) {
  return getDb().booking.findFirst({ where: { id: bookingId, buyerId } });
}

/** The browser says the token was paid. Believed only once the gateway's signature checks out. */
export async function confirmBookingCheckout(
  bookingId: string,
  paymentId: string,
  signature: string,
): Promise<BookingConfirmation> {
  const buyer = await requireUser({ returnTo: "/account/bookings", roles: ["BUYER"] });
  const provider = gateway();
  const booking = await ownBooking(bookingId, buyer.id);
  if (!provider || !booking?.providerOrderId) {
    return {
      ok: false,
      message:
        "We could not match this payment. If money was taken, it will be sorted out shortly.",
    };
  }
  const valid = provider.verifyCheckoutSignature({
    providerOrderId: booking.providerOrderId,
    paymentId: String(paymentId),
    signature: String(signature),
  });
  if (!valid) {
    return {
      ok: false,
      message:
        "We could not verify this payment. If money was taken, it will be sorted out shortly.",
    };
  }
  const db = getDb();
  const result = await settleBooking(db, {
    bookingId: booking.id,
    providerPaymentId: String(paymentId),
    amountPaise: booking.tokenPaise,
    provider: provider.name,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.settledNow && result.outcome !== "already") {
    await afterBookingChange(db, booking.id, result.outcome === "paid" ? "paid" : "refund_due");
  }
  revalidatePath("/account/bookings");
  return { ok: true };
}

/** The practice payment, for the test gateway only. */
export async function payBookingWithTestGateway(formData: FormData) {
  const buyer = await requireUser({ returnTo: "/account/bookings", roles: ["BUYER"] });
  const bookingId = text(formData, "bookingId");
  const here = `/account/bookings/${encodeURIComponent(bookingId)}`;
  if (gateway()?.name !== "test") redirect(`${here}?error=Test+payment+is+not+available.`);
  const booking = await ownBooking(bookingId, buyer.id);
  if (!booking) redirect("/account/bookings");

  const db = getDb();
  const result = await settleBooking(db, {
    bookingId: booking.id,
    providerPaymentId: `pay_test_${randomBytes(6).toString("hex")}`,
    amountPaise: booking.tokenPaise,
    provider: "test",
  });
  if (!result.ok) redirect(`${here}?error=${encodeURIComponent(result.message)}`);
  if (result.settledNow && result.outcome !== "already") {
    await afterBookingChange(db, booking.id, result.outcome === "paid" ? "paid" : "refund_due");
  }
  redirect(here);
}

/** The buyer gives the plot back before paying. */
export async function cancelBookingHold(formData: FormData) {
  const buyer = await requireUser({ returnTo: "/account/bookings", roles: ["BUYER"] });
  const bookingId = text(formData, "bookingId");
  await cancelHold(getDb(), { bookingId, buyerId: buyer.id, reason: "buyer" });
  revalidatePath("/account/bookings");
  redirect(`/account/bookings/${encodeURIComponent(bookingId)}`);
}
