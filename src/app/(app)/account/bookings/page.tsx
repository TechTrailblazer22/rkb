import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { formatPaise } from "@/lib/billing/money";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/leads/format";

export const metadata = { title: "My bookings" };

const LABEL = {
  HELD: "Waiting for payment",
  PAID: "Booked",
  EXPIRED: "Hold ended",
  CANCELLED: "Cancelled",
  REFUND_DUE: "Refund on its way",
  REFUNDED: "Refunded",
} as const;

export default async function MyBookingsPage() {
  const user = await requireUser({ returnTo: "/account/bookings", roles: ["BUYER"] });
  const bookings = await getDb().booking.findMany({
    where: { buyerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      plotNumber: true,
      tokenPaise: true,
      status: true,
      createdAt: true,
      project: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My bookings</h1>
      {bookings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          You have not booked a plot yet. On a project page, choose Book online next to an available
          plot.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="my-bookings">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
              data-testid="my-booking"
              data-status={b.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/account/bookings/${b.id}`}
                  className="font-bold text-teal-800 underline"
                >
                  Plot {b.plotNumber}, {b.project.name}
                </Link>
                <Badge tone={b.status === "PAID" ? "teal" : "neutral"}>{LABEL[b.status]}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Token {formatPaise(b.tokenPaise)} · {formatDate(b.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
