import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { requireUser } from "@/lib/auth/session";
import { formatPaise } from "@/lib/billing/money";
import { getDb } from "@/lib/db";
import { GRACE_DAYS } from "@/lib/entitlements";
import { istToday, parseDay } from "@/lib/featured/service";
import { formatDate } from "@/lib/leads/format";
import { PLAN_LABELS } from "@/lib/plans";
import { refundBookingAction, refundInvoiceAction } from "./actions";

export const metadata = { title: "Billing" };

const DAY = 86_400_000;

export default async function AdminBillingPage({ searchParams }: PageProps<"/admin/billing">) {
  await requireUser({ returnTo: "/admin/billing", roles: ["ADMIN"] });
  const { saved, error } = await searchParams;
  const db = getDb();
  const now = new Date();
  const today = parseDay(istToday(now))!;
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  // Indian midnight is 18:30 the day before, in UTC.
  const monthStartIst = new Date(monthStart.getTime() - 5.5 * 3_600_000);

  const [byPlan, paidThisMonth, pastDue, recentEnded, orders, invoices, failedOrders, bookings] =
    await Promise.all([
      db.subscription.groupBy({
        by: ["plan", "source"],
        where: {
          status: "ACTIVE",
          currentPeriodEnd: { gte: new Date(now.getTime() - GRACE_DAYS * DAY) },
        },
        _count: { _all: true },
      }),
      db.invoice.aggregate({
        where: { status: "PAID", issuedAt: { gte: monthStartIst }, paymentMethod: { not: "comp" } },
        _sum: { subtotalPaise: true, totalPaise: true },
        _count: { _all: true },
      }),
      db.subscription.findMany({
        where: { status: "ACTIVE", currentPeriodEnd: { lt: now } },
        orderBy: { currentPeriodEnd: "asc" },
        take: 20,
        select: {
          builderId: true,
          plan: true,
          currentPeriodEnd: true,
          builder: { select: { companyName: true } },
        },
      }),
      db.subscription.findMany({
        where: { status: "EXPIRED", currentPeriodEnd: { gte: new Date(now.getTime() - 30 * DAY) } },
        orderBy: { currentPeriodEnd: "desc" },
        take: 20,
        select: {
          builderId: true,
          plan: true,
          currentPeriodEnd: true,
          builder: { select: { companyName: true } },
        },
      }),
      db.paymentOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          createdAt: true,
          plan: true,
          change: true,
          totalPaise: true,
          status: true,
          provider: true,
          failureReason: true,
          builder: { select: { companyName: true } },
        },
      }),
      db.invoice.findMany({
        orderBy: { issuedAt: "desc" },
        take: 15,
        select: {
          id: true,
          number: true,
          issuedAt: true,
          totalPaise: true,
          status: true,
          paymentMethod: true,
          builder: { select: { companyName: true } },
        },
      }),
      db.paymentOrder.count({ where: { failureReason: { not: null }, status: { not: "PAID" } } }),
      db.booking.findMany({
        where: { status: { in: ["PAID", "REFUND_DUE", "REFUNDED"] } },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          plotNumber: true,
          tokenPaise: true,
          status: true,
          note: true,
          buyerName: true,
          project: { select: { name: true } },
          builder: { select: { companyName: true } },
        },
      }),
    ]);

  const active = byPlan.reduce((n, row) => n + row._count._all, 0);
  const paid = byPlan
    .filter((row) => row.source !== "COMP")
    .reduce((n, row) => n + row._count._all, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="billing" />

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

      <section className="grid gap-4 sm:grid-cols-4" data-testid="billing-stats">
        {[
          ["Plans in force", String(active), `${paid} paid, ${active - paid} complimentary`],
          [
            "Received this month",
            formatPaise(paidThisMonth._sum.totalPaise ?? 0),
            `${formatPaise(paidThisMonth._sum.subtotalPaise ?? 0)} before GST, ${paidThisMonth._count._all} invoices`,
          ],
          ["Past due", String(pastDue.length), `inside the ${GRACE_DAYS}-day grace period`],
          ["Payments needing a look", String(failedOrders), "failed or mismatched orders"],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-2xl font-extrabold">{value}</p>
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Renewals to chase</h2>
        {pastDue.length + recentEnded.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Nothing overdue.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="chase-list">
            {[
              ...pastDue.map((s) => ({ ...s, ended: false })),
              ...recentEnded.map((s) => ({ ...s, ended: true })),
            ].map((s) => (
              <li
                key={s.builderId}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <Link
                  href={`/admin/builders/${s.builderId}`}
                  className="font-semibold text-teal-800 underline"
                >
                  {s.builder.companyName ?? "(no name)"}
                </Link>
                <span>{PLAN_LABELS[s.plan]}</span>
                <span className="text-slate-600">ended {formatDate(s.currentPeriodEnd)}</span>
                {s.ended ? (
                  <Badge tone="amber">Offline</Badge>
                ) : (
                  <Badge tone="neutral">In grace</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Recent payments</h2>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No online payments yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="orders">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-semibold">{o.builder.companyName ?? "(no name)"}</span>
                <span>
                  {o.change.toLowerCase()} {PLAN_LABELS[o.plan]}
                </span>
                <span>{formatPaise(o.totalPaise)}</span>
                <span className="text-slate-600">{o.provider}</span>
                <Badge
                  tone={o.status === "PAID" ? "teal" : o.status === "FAILED" ? "amber" : "neutral"}
                >
                  {o.status.toLowerCase()}
                </Badge>
                {o.failureReason && o.status !== "PAID" && (
                  <span className="w-full text-xs text-red-700">{o.failureReason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="admin-bookings"
      >
        <h2 className="text-lg font-bold">Token bookings</h2>
        <p className="mt-1 text-xs text-slate-500">
          Tokens go to the builder&apos;s linked account. A token marked refund due arrived after
          its hold ended or for a plot that was taken: refund it here.
        </p>
        {bookings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No bookings yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {bookings.map((b) => (
              <li
                key={b.id}
                className="space-y-2 py-3"
                data-testid="admin-booking"
                data-status={b.status}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    Plot {b.plotNumber}, {b.project.name}
                  </span>
                  <span>{b.builder.companyName ?? "(no name)"}</span>
                  <span className="text-slate-600">{b.buyerName}</span>
                  <span>{formatPaise(b.tokenPaise)}</span>
                  <Badge
                    tone={
                      b.status === "PAID" ? "teal" : b.status === "REFUND_DUE" ? "amber" : "neutral"
                    }
                  >
                    {b.status === "REFUND_DUE" ? "refund due" : b.status.toLowerCase()}
                  </Badge>
                </div>
                {b.status === "REFUND_DUE" && b.note && (
                  <p className="text-xs text-red-700">{b.note}</p>
                )}
                {(b.status === "PAID" || b.status === "REFUND_DUE") && (
                  <form action={refundBookingAction} className="flex flex-wrap items-center gap-2">
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Recent invoices</h2>
        <p className="mt-1 text-xs text-slate-500">
          To record a payment made outside the website, open the company and use &ldquo;Put this
          company on a plan&rdquo;. Whether a refund needs a credit note is a question for your CA.
        </p>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No invoices yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="admin-invoices">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/billing/invoices/${invoice.id}`}
                    className="font-semibold text-teal-800 underline"
                  >
                    {invoice.number}
                  </Link>
                  <span>{invoice.builder.companyName ?? "(no name)"}</span>
                  <span className="text-slate-600">{formatDate(invoice.issuedAt)}</span>
                  <span>{formatPaise(invoice.totalPaise)}</span>
                  <span className="text-slate-600">{invoice.paymentMethod}</span>
                  <Badge tone={invoice.status === "PAID" ? "teal" : "amber"}>
                    {invoice.status.toLowerCase()}
                  </Badge>
                </div>
                {invoice.status === "PAID" && invoice.paymentMethod !== "comp" && (
                  <form action={refundInvoiceAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <label className="min-w-0 flex-1 basis-56">
                      <span className="sr-only">Reason for refunding {invoice.number}</span>
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
                      Refund
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
