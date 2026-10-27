"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { afterBookingChange } from "@/lib/booking/after";
import { refundBooking } from "@/lib/booking/service";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";

function back(params: Record<string, string>): never {
  redirect(`/portal/bookings?${new URLSearchParams(params).toString()}`);
}

/** The company refunds a token it received. Owner only; it can only touch its own bookings. */
export async function refundOwnBooking(formData: FormData) {
  const ctx = await requireBuilderContext("/portal/bookings", { ownerOnly: true });
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
    actorId: ctx.user.id,
    builderId: ctx.builder.id,
    note,
    provider,
  });
  if (!result.ok) back({ error: result.message });
  await afterBookingChange(getDb(), result.booking.id, "refunded");
  revalidatePath("/portal/bookings");
  back({ saved: "The token was refunded and the plot is available again." });
}
