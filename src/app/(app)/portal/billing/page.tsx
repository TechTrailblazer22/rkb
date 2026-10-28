import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { formatPaise } from "@/lib/billing/money";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { quoteChange } from "@/lib/billing/quote";
import { supplierFromEnv } from "@/lib/billing/subscriptions";
import { loadPlanUsage } from "@/lib/billing/usage";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { GRACE_DAYS, LIMITS } from "@/lib/entitlements";
import { formatDate } from "@/lib/leads/format";
import { GST_PERCENT, PLAN_LABELS, plans } from "@/lib/plans";
import {
  cancelRenewal,
  keepPlan,
  requestScheduledChange,
  startCheckout,
  withdrawScheduledChange,
} from "./actions";

export const metadata = { title: "Plan and billing" };

type Code = "STARTER" | "GROWTH" | "PREMIER";
const CODES: Code[] = ["STARTER", "GROWTH", "PREMIER"];

function Meter({
  label,
  used,
  limit,
  testId,
}: {
  label: string;
  used: number;
  limit: number | null;
  testId: string;
}) {
  const percent = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-slate-600">
          {used} of {limit === null ? "unlimited" : limit}
        </span>
      </div>
      {limit !== null && (
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <div
            className={`h-full rounded-full ${percent >= 100 ? "bg-amber-500" : "bg-teal-600"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

const yes = (on: boolean) =>
  on ? (
    <Check className="size-4 text-teal-700" aria-label="Included" />
  ) : (
    <Minus className="size-4 text-slate-400" aria-label="Not included" />
  );

const ROWS: [string, (code: Code) => React.ReactNode][] = [
  [
    "Projects",
    (c) => (LIMITS[c].maxProjects === null ? "Unlimited" : `Up to ${LIMITS[c].maxProjects}`),
  ],
  ["Photos per project", (c) => String(LIMITS[c].maxPhotosPerProject)],
  ["Video", (c) => yes(LIMITS[c].video)],
  ["360° tour", (c) => yes(LIMITS[c].tour360)],
  ["Team seats", (c) => String(LIMITS[c].teamSeats)],
  ["Lead dashboard", (c) => (LIMITS[c].leads === "full" ? "Full" : "Basic")],
  [
    "Featured days a month",
    (c) =>
      LIMITS[c].featuredDaysPerMonth > 0 ? String(LIMITS[c].featuredDaysPerMonth) : yes(false),
  ],
  ["Priority listing", (c) => yes(LIMITS[c].priorityListing)],
  ["Homepage spotlight", (c) => yes(LIMITS[c].homepageSpotlight)],
];

export default async function BillingPage({ searchParams }: PageProps<"/portal/billing">) {
  const ctx = await requireBuilderContext("/portal/billing", { ownerOnly: true });
  const { saved, error, blockers } = await searchParams;
  const db = getDb();
  const [subscription, invoices, usage] = await Promise.all([
    db.subscription.findUnique({ where: { builderId: ctx.builder.id } }),
    db.invoice.findMany({
      where: { builderId: ctx.builder.id },
      orderBy: { issuedAt: "desc" },
      take: 24,
      select: { id: true, number: true, issuedAt: true, totalPaise: true, status: true },
    }),
    loadPlanUsage(db, ctx.builder.id),
  ]);
  const e = ctx.entitlements;
  const late = subscription && e.active && new Date() > subscription.currentPeriodEnd;

  let online = false;
  try {
    online = providerFor(billingConfig()) !== null;
  } catch {
    online = false;
  }
  const supplierState = supplierFromEnv().state;
  const now = new Date();
  const quoteFor = (plan: Code, interval: "MONTHLY" | "ANNUAL") =>
    quoteChange({
      current: subscription,
      target: { plan, interval },
      now,
      supplierState,
      customerState: ctx.builder.state,
    });

  return (
    <div className="space-y-6">
      {typeof saved === "string" && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
        >
          {saved}
        </p>
      )}
      {typeof error === "string" && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"
          data-testid="billing-error"
        >
          <p className="font-medium">{error}</p>
          {typeof blockers === "string" && blockers && (
            <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="billing-blockers">
              {blockers.split("\n").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="plan-card"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">
            {e.plan ? `${PLAN_LABELS[e.plan]} plan` : "Free plan"}
          </h2>
          {subscription && e.active && !late && <Badge tone="teal">Active</Badge>}
          {late && <Badge tone="amber">Payment overdue</Badge>}
          {subscription && !e.active && <Badge tone="amber">Ended</Badge>}
        </div>

        {subscription ? (
          <p className="mt-2 text-sm text-slate-700" data-testid="plan-dates">
            {e.active
              ? late
                ? `Your plan ended on ${formatDate(subscription.currentPeriodEnd)}. It stays in force for ${GRACE_DAYS} more days so you can renew without a break. After that you are on the free plan: your live projects stay live, and the extras switch off.`
                : subscription.source === "COMP"
                  ? `A complimentary plan, until ${formatDate(subscription.currentPeriodEnd)}.`
                  : `Paid until ${formatDate(subscription.currentPeriodEnd)}.`
              : `Your plan ended on ${formatDate(subscription.currentPeriodEnd)}. You are on the free plan: your projects stay live and your data is safe. A plan brings the extras back.`}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-700">
            You are on the free plan: you can publish projects without paying. A plan gives you more
            projects, video, the full lead dashboard, analytics and featured days.
          </p>
        )}

        {subscription && e.active && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {subscription.pendingPlan && (
              <div data-testid="pending-change" className="rounded-lg bg-slate-50 px-3 py-2">
                From {formatDate(subscription.currentPeriodEnd)} you move to{" "}
                <strong>
                  {PLAN_LABELS[subscription.pendingPlan]}
                  {subscription.pendingInterval === "ANNUAL" ? ", annual" : ", monthly"}
                </strong>
                .{" "}
                <form action={withdrawScheduledChange} className="inline">
                  <button type="submit" className="font-semibold text-teal-800 underline">
                    Withdraw
                  </button>
                </form>
              </div>
            )}
            {subscription.cancelAtPeriodEnd ? (
              <div data-testid="cancel-note" className="rounded-lg bg-amber-50 px-3 py-2">
                You chose not to renew. Your plan ends on{" "}
                {formatDate(subscription.currentPeriodEnd)}.{" "}
                <form action={keepPlan} className="inline">
                  <button type="submit" className="font-semibold text-teal-800 underline">
                    Keep my plan
                  </button>
                </form>
              </div>
            ) : (
              <form action={cancelRenewal}>
                <button
                  type="submit"
                  data-testid="cancel-renewal"
                  className="text-sm font-semibold text-slate-600 underline"
                >
                  Do not renew
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="choose-plan"
      >
        <h2 className="text-lg font-bold">
          {e.active ? "Renew or change your plan" : "Choose a plan"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Prices exclude {GST_PERCENT}% GST, which is added at checkout. Paying for a year costs ten
          months. There are no commissions on your sales. Plans are not renewed automatically: we
          remind you before yours ends, and you pay when you choose to.
        </p>
        {!online && (
          <p
            className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="no-online-payment"
          >
            Online payment is not available yet. Our team can set your plan up after you contact us.
          </p>
        )}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.code}
              data-testid={`plan-option-${plan.code}`}
              className={`rounded-xl border-2 p-4 ${e.plan === plan.code ? "border-teal-700" : "border-slate-200"}`}
            >
              <h3 className="flex items-center justify-between gap-2 font-bold">
                {plan.name}
                {e.plan === plan.code && <Badge tone="teal">Your plan</Badge>}
              </h3>
              <div className="mt-3 space-y-2">
                {(["MONTHLY", "ANNUAL"] as const).map((interval) => {
                  const quote = quoteFor(plan.code, interval);
                  const label = interval === "ANNUAL" ? "Yearly" : "Monthly";
                  if (quote.kind === "none") {
                    return (
                      <p key={interval} className="text-xs text-slate-500">
                        {label}: {quote.reason}
                      </p>
                    );
                  }
                  const verb =
                    quote.kind === "schedule"
                      ? "Switch at renewal"
                      : quote.change === "RENEW"
                        ? "Renew"
                        : quote.change === "UPGRADE"
                          ? "Upgrade"
                          : "Subscribe";
                  const list = plan.priceMonthly * (interval === "ANNUAL" ? 10 : 1) * 100;
                  return (
                    <form
                      key={interval}
                      action={quote.kind === "schedule" ? requestScheduledChange : startCheckout}
                    >
                      <input type="hidden" name="plan" value={plan.code} />
                      <input type="hidden" name="interval" value={interval} />
                      <button
                        type="submit"
                        disabled={!online && quote.kind === "pay"}
                        data-testid={`buy-${plan.code}-${interval}`}
                        className={`${buttonClass(quote.kind === "pay" ? "primary" : "secondary")} h-auto w-full flex-col items-start gap-0 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span>
                          {verb}: {label}
                        </span>
                        <span className="text-xs font-normal opacity-90">
                          {formatPaise(list)} + GST
                          {quote.kind === "pay" && quote.creditPaise > 0
                            ? `, less ${formatPaise(quote.creditPaise)} credit`
                            : ""}
                          {quote.kind === "pay"
                            ? ` · pay ${formatPaise(quote.gst.totalPaise)}`
                            : ` · from ${formatDate(quote.effectiveOn)}`}
                        </span>
                      </button>
                    </form>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">What you are using</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Meter
            label="Projects"
            used={usage.projects}
            limit={e.maxProjects}
            testId="meter-projects"
          />
          <Meter label="Team seats" used={usage.seats} limit={e.teamSeats} testId="meter-seats" />
          {e.featuredDaysPerMonth > 0 && (
            <Meter
              label="Featured days this month"
              used={usage.featuredThisMonth}
              limit={e.featuredDaysPerMonth}
              testId="meter-featured"
            />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">What each plan includes</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Plan limits</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Feature
                </th>
                {CODES.map((code) => (
                  <th
                    key={code}
                    scope="col"
                    className={`px-3 py-2 font-semibold ${e.plan === code ? "text-teal-700" : ""}`}
                  >
                    {PLAN_LABELS[code]}
                    {e.plan === code && <span className="sr-only"> (your plan)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {label}
                  </th>
                  {CODES.map((code) => (
                    <td key={code} className="px-3 py-2">
                      {value(code)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No invoices yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="invoices">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <Link
                  href={`/portal/billing/invoices/${invoice.id}`}
                  className="font-semibold text-teal-800 underline"
                >
                  {invoice.number}
                </Link>
                <span className="text-slate-600">{formatDate(invoice.issuedAt)}</span>
                <span>{formatPaise(invoice.totalPaise)}</span>
                <span className="text-slate-600">{invoice.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
