"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { refundInvoice } from "@/lib/billing/payments";
import { afterBookingChange } from "@/lib/booking/after";
import { refundBooking } from "@/lib/booking/service";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { getDb } from "@/lib/db";

function back(params: Record<string, string>): never {
  redirect(`/admin/billing?${new URLSearchParams(params).toString()}`);
}

/** Staff refund an invoice, online through the gateway when it was paid there. A note is required. */
export async function refundInvoiceAction(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin/billing", roles: ["ADMIN"] });
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5 || note.length > 300) {
    back({ error: "Write a short reason for the refund (5 to 300 characters)." });
  }
  let provider = null;
  try {
    provider = providerFor(billingConfig());
  } catch {
    provider = null;
  }
  const result = await refundInvoice(getDb(), { invoiceId, note, actorId: admin.id, provider });
  revalidatePath("/admin/billing");
  if (!result.ok) back({ error: result.message });
  back({
    saved: result.gatewayRefundId
      ? `Refunded through the gateway (${result.gatewayRefundId}).`
      : "Marked as refunded. Return the money yourself if it was paid outside the website.",
  });
}

/** Staff refund a token (a paid booking, or one flagged for refund). A reason is required. */
export async function refundBookingAction(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin/billing", roles: ["ADMIN"] });
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5 || note.length > 300) {
    back({ error: "Write a short reason for the refund (5 to 300 characters)." });
  }
  let provider = null;
  try {
    provider = providerFor(billingConfig());
  } catch {
    provider = null;
  }
  const result = await refundBooking(getDb(), {
    bookingId: String(formData.get("bookingId") ?? ""),
    actorId: admin.id,
    note,
    provider,
  });
  if (!result.ok) back({ error: result.message });
  await afterBookingChange(getDb(), result.booking.id, "refunded");
  revalidatePath("/admin/billing");
  back({ saved: "Token refunded." });
}
