import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { formatDate } from "@/lib/leads/format";
import { GRACE_DAYS, isInForce } from "@/lib/entitlements";
import { formatPaise } from "@/lib/billing/money";
import { getDb } from "@/lib/db";
import { PLAN_LABELS, plans } from "@/lib/plans";
import { assignPlan } from "@/app/(app)/admin/builders/[id]/plan-actions";
import { setPayoutAccount } from "@/app/(app)/admin/builders/[id]/payout-actions";

const SOURCE_LABEL = {
  MANUAL: "Paid outside the website",
  GATEWAY: "Paid online",
  COMP: "Complimentary",
} as const;

/** What plan a company is on, its invoices, and the form to put it on a plan. Admin only. */
export async function AdminPlanSection({ builderId }: { builderId: string }) {
  const db = getDb();
  const [subscription, invoices, builder] = await Promise.all([
    db.subscription.findUnique({ where: { builderId } }),
    db.invoice.findMany({
      where: { builderId },
      orderBy: { issuedAt: "desc" },
      take: 10,
      select: { id: true, number: true, issuedAt: true, totalPaise: true, status: true },
    }),
    db.builder.findUnique({ where: { id: builderId }, select: { payoutAccountId: true } }),
  ]);
  const inForce = isInForce(subscription);
  const state = !subscription
    ? "No plan"
    : inForce
      ? new Date() > subscription.currentPeriodEnd
        ? `Late: in the ${GRACE_DAYS}-day grace period`
        : "Active"
      : "Ended";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6" data-testid="admin-plan">
      <h2 className="text-lg font-bold">Plan and billing</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Plan</dt>
          <dd className="font-medium" data-testid="admin-plan-name">
            {subscription
              ? `${PLAN_LABELS[subscription.plan]}, ${subscription.interval === "ANNUAL" ? "annual" : "monthly"}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Status</dt>
          <dd className="font-medium" data-testid="admin-plan-state">
            {state}
          </dd>
        </div>
        {subscription && (
          <>
            <div>
              <dt className="text-slate-500">Paid until</dt>
              <dd className="font-medium">{formatDate(subscription.currentPeriodEnd)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">How it was set</dt>
              <dd className="font-medium">{SOURCE_LABEL[subscription.source]}</dd>
            </div>
            {subscription.note && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Note</dt>
                <dd className="font-medium">{subscription.note}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {invoices.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold">Invoices</h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-medium">{invoice.number}</span>
                <span className="text-slate-600">{formatDate(invoice.issuedAt)}</span>
                <span>{formatPaise(invoice.totalPaise)}</span>
                <span className="text-slate-600">{invoice.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={assignPlan} className="mt-6 space-y-4 border-t border-slate-100 pt-5">
        <input type="hidden" name="builderId" value={builderId} />
        <h3 className="text-sm font-bold">Put this company on a plan</h3>
        <p className="text-xs text-slate-600">
          This replaces any plan it has now and starts today. Paid plans get a GST invoice. A
          complimentary plan has no invoice. Projects that were paused because the plan ended go
          live again.
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="plan-code" label="Plan">
            <select id="plan-code" name="plan" defaultValue="GROWTH" className={inputClass}>
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="plan-interval" label="Billing">
            <select
              id="plan-interval"
              name="interval"
              defaultValue="MONTHLY"
              className={inputClass}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </Field>
          <Field id="plan-periods" label="Number of periods" hint="Months or years, as billed.">
            <input
              id="plan-periods"
              name="periods"
              type="number"
              min={1}
              max={24}
              defaultValue={1}
              required
              className={inputClass}
            />
          </Field>
          <Field id="plan-kind" label="Payment">
            <select id="plan-kind" name="kind" defaultValue="paid" className={inputClass}>
              <option value="paid">Paid, issue an invoice</option>
              <option value="comp">Complimentary</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="plan-amount"
            label="Amount before GST, in rupees"
            hint="Leave empty for the list price."
          >
            <input
              id="plan-amount"
              name="amount"
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              className={inputClass}
            />
          </Field>
          <Field id="plan-reference" label="Payment reference" hint="For example the bank UTR.">
            <input id="plan-reference" name="reference" maxLength={100} className={inputClass} />
          </Field>
          <Field id="plan-note" label="Note">
            <input id="plan-note" name="note" maxLength={300} className={inputClass} />
          </Field>
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Set plan
        </button>
      </form>

      <form
        action={setPayoutAccount}
        className="mt-6 space-y-3 border-t border-slate-100 pt-5"
        data-testid="payout-form"
      >
        <input type="hidden" name="builderId" value={builderId} />
        <h3 className="text-sm font-bold">Online token booking: payout account</h3>
        <p className="text-xs text-slate-600">
          The Razorpay Route linked account that receives this company&apos;s token payments (it
          looks like acc_AbC123...). Without it, buyers cannot book this company&apos;s plots
          online, because the money would otherwise stay with us. Leave empty to disconnect.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <Field id="payout-account" label="Linked account id">
              <input
                id="payout-account"
                name="payoutAccountId"
                defaultValue={builder?.payoutAccountId ?? ""}
                maxLength={40}
                className={inputClass}
              />
            </Field>
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
