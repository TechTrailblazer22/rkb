import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatPaise } from "@/lib/billing/money";
import { bookingConfig } from "@/lib/booking/config";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/leads/format";
import { refundOwnBooking } from "./actions";

export const metadata = { title: "Bookings" };

const LABEL = {
  HELD: "On hold",
  PAID: "Paid",
  EXPIRED: "Hold ended",
  CANCELLED: "Cancelled",
  REFUND_DUE: "To be refunded",
  REFUNDED: "Refunded",
} as const;

export default async function PortalBookingsPage({ searchParams }: PageProps<"/portal/bookings">) {
  const ctx = await requireBuilderContext("/portal/bookings");
  const { saved, error } = await searchParams;
  const bookings = await getDb().booking.findMany({
    where: { builderId: ctx.builder.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      plotNumber: true,
      tokenPaise: true,
      status: true,
      buyerName: true,
      buyerMobile: true,
      paidAt: true,
      createdAt: true,
      project: { select: { name: true } },
    },
  });
  const enabled = bookingConfig().enabled;
  const owner = ctx.memberRole === "OWNER";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Online bookings</h2>
        <p className="mt-1 text-sm text-slate-600">
          Buyers can book an available plot with a token, paid online straight to your account
          {ctx.builder.payoutAccountId
            ? "."
            : ". This is not switched on for your company yet: our team connects your payout account first."}
          {!enabled &&
            " Online booking is switched off on the platform for now, so buyers see Request booking instead."}
        </p>
      </div>
      {typeof saved === "string" && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
        >
          {saved}
        </p>
      )}
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {bookings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No online bookings yet.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="company-bookings">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
              data-testid="company-booking"
              data-status={b.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  Plot {b.plotNumber}, {b.project.name}
                </p>
                <Badge
                  tone={
                    b.status === "PAID" ? "teal" : b.status === "REFUND_DUE" ? "amber" : "neutral"
                  }
                >
                  {LABEL[b.status]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {b.buyerName}, {b.buyerMobile} · token {formatPaise(b.tokenPaise)} ·{" "}
                {formatDateTime(b.paidAt ?? b.createdAt)}
              </p>
              {owner && (b.status === "PAID" || b.status === "REFUND_DUE") && (
                <form action={refundOwnBooking} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <label className="min-w-0 flex-1 basis-56">
                    <span className="sr-only">Reason for refunding plot {b.plotNumber}</span>
                    <input
                      name="note"
                      required
                      minLength={5}
                      maxLength={300}
                      placeholder="Reason for the refund"
                      className={inputClass}
                    />
                  </label>
                  <button type="submit" className={buttonClass("secondary")}>
                    Refund the token
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
