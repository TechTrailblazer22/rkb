import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { requireUser } from "@/lib/auth/session";
import { formatPaise } from "@/lib/billing/money";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { bookingAvailability, bookingConfig } from "@/lib/booking/config";
import { getDb } from "@/lib/db";
import { formatRupees } from "@/lib/format";
import { startBooking } from "../../bookings/actions";

export const metadata = { title: "Book a plot", robots: { index: false } };

export default async function BookPlotPage({
  params,
  searchParams,
}: PageProps<"/account/book/[plotId]">) {
  const { plotId } = await params;
  const { error } = await searchParams;
  const user = await requireUser({ returnTo: `/account/book/${plotId}`, roles: ["BUYER"] });
  const plot = await getDb().plot.findUnique({
    where: { id: plotId },
    select: {
      id: true,
      number: true,
      sizeSqft: true,
      price: true,
      status: true,
      project: {
        select: {
          name: true,
          slug: true,
          status: true,
          tokenAmount: true,
          builder: { select: { companyName: true, status: true, payoutAccountId: true } },
        },
      },
    },
  });
  if (!plot || plot.project.status !== "LIVE") notFound();

  let configured = false;
  try {
    configured = providerFor(billingConfig()) !== null;
  } catch {
    configured = false;
  }
  const offer = bookingAvailability({
    config: bookingConfig(),
    paymentsConfigured: configured,
    projectLive: true,
    builderVerified: plot.project.builder.status === "VERIFIED",
    payoutAccountId: plot.project.builder.payoutAccountId,
    tokenRupees: plot.project.tokenAmount,
  });
  if (!offer.available) redirect(`/project/${plot.project.slug}`);
  const config = bookingConfig();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <Link
          href={`/project/${plot.project.slug}#plots`}
          className="text-sm font-semibold text-teal-700 underline"
        >
          Back to {plot.project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Book plot {plot.number}</h1>
      </div>

      {typeof error === "string" && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          data-testid="book-error"
        >
          {error}
        </p>
      )}

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5"
        data-testid="book-summary"
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Project</dt>
            <dd className="font-semibold">{plot.project.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Builder</dt>
            <dd className="font-semibold">{plot.project.builder.companyName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Plot</dt>
            <dd className="font-semibold">
              {plot.number}, {plot.sizeSqft.toLocaleString("en-IN")} sq ft
            </dd>
          </div>
          {plot.price && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Listed price</dt>
              <dd className="font-semibold">{formatRupees(plot.price)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-bold">
            <dt>Token to pay now</dt>
            <dd data-testid="token-amount">{formatPaise(offer.tokenPaise)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-amber-500/40 bg-amber-50 p-5 text-sm text-slate-800">
        <h2 className="font-bold">Before you pay</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            The token is an <strong>advance paid to the builder</strong>, not to RKB, and it is not
            the full price. RKB takes no commission.
          </li>
          <li>
            We hold the plot for you for <strong>{config.holdMinutes} minutes</strong> while you
            pay. If you do not pay in time, it is released.
          </li>
          <li>
            If you pay but the plot cannot be booked for you (for example the hold had ended), the
            token is refunded in full.
          </li>
          <li>
            Other refunds are between you and the builder under their terms; staff can refund a
            token when asked. Read the project&apos;s approvals and agree the sale terms with the
            builder before relying on a booking.
          </li>
        </ul>
      </section>

      <form
        action={startBooking}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <input type="hidden" name="plotId" value={plot.id} />
        <Field id="book-name" label="Your name" required>
          <input
            id="book-name"
            name="name"
            required
            minLength={2}
            maxLength={80}
            defaultValue={user.name ?? ""}
            autoComplete="name"
            className={inputClass}
          />
        </Field>
        <Field
          id="book-mobile"
          label="Mobile number"
          required
          hint="The builder will call you on this number."
        >
          <input
            id="book-mobile"
            name="mobile"
            required
            inputMode="tel"
            defaultValue={user.mobile ?? ""}
            autoComplete="tel"
            className={inputClass}
          />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="agree"
            required
            className="mt-0.5 size-5 shrink-0 accent-teal-700"
          />
          <span>
            I have read the notes above. I agree that RKB shares my name and mobile number with{" "}
            {plot.project.builder.companyName} and holds this plot for me while I pay. See the{" "}
            <Link href="/terms" target="_blank" className="font-semibold text-teal-700 underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="font-semibold text-teal-700 underline">
              Privacy Notice
            </Link>
            .
          </span>
        </label>
        <button
          type="submit"
          className={`${buttonClass("primary", "lg")} w-full`}
          data-testid="hold-and-pay"
        >
          Hold plot {plot.number} and pay {formatPaise(offer.tokenPaise)}
        </button>
      </form>
    </div>
  );
}
