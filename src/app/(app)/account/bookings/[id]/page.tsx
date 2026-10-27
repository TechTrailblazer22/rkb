import Link from "next/link";
import { notFound } from "next/navigation";
import { HoldCountdown } from "@/components/public/hold-countdown";
import { RazorpayButton } from "@/components/portal/razorpay-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { formatPaise } from "@/lib/billing/money";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/leads/format";
import { cancelBookingHold, confirmBookingCheckout, payBookingWithTestGateway } from "../actions";

export const metadata = { title: "Booking", robots: { index: false } };

export default async function BookingPage({
  params,
  searchParams,
}: PageProps<"/account/bookings/[id]">) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser({ returnTo: `/account/bookings/${id}`, roles: ["BUYER"] });
  // Found through the logged-in buyer, so another person's booking id is simply not found.
  const booking = await getDb().booking.findFirst({
    where: { id, buyerId: user.id },
    include: { project: { select: { name: true, slug: true } } },
  });
  if (!booking) notFound();

  let provider = null;
  try {
    provider = providerFor(billingConfig());
  } catch {
    provider = null;
  }
  const live = booking.status === "HELD" && booking.holdExpiresAt > new Date();
  const token = formatPaise(booking.tokenPaise);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <Link href="/account/bookings" className="text-sm font-semibold text-teal-700 underline">
          My bookings
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          Plot {booking.plotNumber}, {booking.project.name}
        </h1>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {provider?.name === "test" && live && (
        <p
          role="note"
          data-testid="test-mode"
          className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-sm font-semibold text-amber-900"
        >
          TEST MODE. No money moves here. This is a practice payment for development and
          demonstrations.
        </p>
      )}

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 text-sm"
        data-testid="booking-state"
        data-status={booking.status}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-bold">Token {token}</p>
          {booking.status === "PAID" && <Badge tone="teal">Booked</Badge>}
        </div>

        {live && (
          <div className="mt-3">
            <HoldCountdown expiresAt={booking.holdExpiresAt.toISOString()} />
          </div>
        )}

        {booking.status === "HELD" && !live && (
          <p className="mt-3 font-semibold text-red-700" data-testid="hold-over">
            The hold on this plot has ended. If you have paid, do not worry: a payment that arrives
            late is refunded in full. Otherwise you can book the plot again from the project page.
          </p>
        )}
        {booking.status === "PAID" && (
          <p className="mt-3" data-testid="booking-paid">
            Paid on {booking.paidAt ? formatDateTime(booking.paidAt) : "(date missing)"}. The plot
            is booked in your name. The builder has been told and will contact you. Keep the receipt
            email.
          </p>
        )}
        {booking.status === "EXPIRED" && (
          <p className="mt-3">The hold ended before the payment was made. Nothing was charged.</p>
        )}
        {booking.status === "CANCELLED" && (
          <p className="mt-3">You gave this plot back. Nothing was charged.</p>
        )}
        {booking.status === "REFUND_DUE" && (
          <p className="mt-3" data-testid="booking-refund-due">
            We could not book this plot for you (
            {booking.note ?? "the booking could not be completed"}). Your token of {token} will be
            refunded in full. We have told our team.
          </p>
        )}
        {booking.status === "REFUNDED" && (
          <p className="mt-3" data-testid="booking-refunded">
            Your token was refunded
            {booking.refundedAt ? ` on ${formatDateTime(booking.refundedAt)}` : ""}. Banks usually
            take 5 to 7 working days to show it.
          </p>
        )}
      </section>

      {live && provider?.name === "test" && (
        <form action={payBookingWithTestGateway}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <button
            type="submit"
            className={`${buttonClass("primary", "lg")} w-full`}
            data-testid="pay-test"
          >
            Pay {token} (test)
          </button>
        </form>
      )}
      {live && provider?.name === "razorpay" && provider.publicKey && booking.providerOrderId && (
        <RazorpayButton
          orderId={booking.id}
          providerOrderId={booking.providerOrderId}
          keyId={provider.publicKey}
          amountPaise={booking.tokenPaise}
          description={`Token for plot ${booking.plotNumber}, ${booking.project.name}`}
          email={user.email}
          name={user.name}
          confirm={confirmBookingCheckout}
          doneHref={`/account/bookings/${booking.id}`}
        />
      )}
      {live && (
        <form action={cancelBookingHold}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <button
            type="submit"
            className="text-sm font-semibold text-slate-600 underline"
            data-testid="cancel-hold"
          >
            Give the plot back
          </button>
        </form>
      )}
    </div>
  );
}
