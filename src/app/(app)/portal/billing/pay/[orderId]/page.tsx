import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RazorpayButton } from "@/components/portal/razorpay-button";
import { buttonClass } from "@/components/ui/button";
import { formatPaise } from "@/lib/billing/money";
import { computeGst } from "@/lib/billing/money";
import { billingConfig, providerFor } from "@/lib/billing/provider";
import { supplierFromEnv } from "@/lib/billing/subscriptions";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { PLAN_LABELS } from "@/lib/plans";
import { confirmCheckout, payWithTestGateway } from "../../actions";

export const metadata = { title: "Pay for your plan" };

const CHANGE_TEXT = {
  SUBSCRIBE: "Start",
  RENEW: "Renew",
  UPGRADE: "Upgrade to",
} as const;

export default async function PayPage({ params }: PageProps<"/portal/billing/pay/[orderId]">) {
  const { orderId } = await params;
  const ctx = await requireBuilderContext(`/portal/billing/pay/${orderId}`, { ownerOnly: true });
  const order = await getDb().paymentOrder.findFirst({
    where: { id: orderId, builderId: ctx.builder.id },
  });
  if (!order) notFound();
  if (order.status === "PAID")
    redirect("/portal/billing?saved=Payment+received.+Your+plan+is+active.");

  let provider = null;
  try {
    provider = providerFor(billingConfig());
  } catch {
    provider = null;
  }
  const gst = computeGst({
    subtotalPaise: order.subtotalPaise,
    supplierState: supplierFromEnv().state,
    customerState: ctx.builder.state,
  });
  const planName = PLAN_LABELS[order.plan];
  const period = order.interval === "ANNUAL" ? "year" : "month";
  const usable = order.status === "CREATED" && provider?.name === order.provider;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h2 className="text-lg font-bold">
        {CHANGE_TEXT[order.change]} the {planName} plan
      </h2>

      {provider?.name === "test" && (
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
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="order-summary"
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">
              {planName}, one {period}
            </dt>
            <dd>{formatPaise(order.listPaise)}</dd>
          </div>
          {order.creditPaise > 0 && (
            <div className="flex justify-between gap-4 text-teal-800">
              <dt>Credit for the unused part of your current plan</dt>
              <dd>- {formatPaise(order.creditPaise)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-2">
            <dt className="text-slate-600">Amount before GST</dt>
            <dd>{formatPaise(order.subtotalPaise)}</dd>
          </div>
          {gst.igstPaise > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">IGST 18%</dt>
              <dd>{formatPaise(gst.igstPaise)}</dd>
            </div>
          ) : (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">CGST 9%</dt>
                <dd>{formatPaise(gst.cgstPaise)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">SGST 9%</dt>
                <dd>{formatPaise(gst.sgstPaise)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-bold">
            <dt>Total to pay</dt>
            <dd data-testid="order-total">{formatPaise(order.totalPaise)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          You get a tax invoice by email and on your billing page. The plan starts as soon as the
          payment is confirmed.
        </p>
      </section>

      {!usable ? (
        <div className="space-y-3 text-sm">
          <p role="alert" className="font-medium text-amber-800">
            {order.status === "EXPIRED"
              ? "This payment was replaced by a newer one. Start again from the billing page."
              : "Online payment is not available right now."}
          </p>
          <Link href="/portal/billing" className={buttonClass("secondary")}>
            Back to billing
          </Link>
        </div>
      ) : provider?.name === "test" ? (
        <form action={payWithTestGateway}>
          <input type="hidden" name="orderId" value={order.id} />
          <button type="submit" className={buttonClass("primary", "lg")}>
            Pay {formatPaise(order.totalPaise)} (test)
          </button>
        </form>
      ) : provider?.publicKey && order.providerOrderId ? (
        <RazorpayButton
          orderId={order.id}
          providerOrderId={order.providerOrderId}
          keyId={provider.publicKey}
          amountPaise={order.totalPaise}
          description={`${planName} plan, one ${period}`}
          email={ctx.user.email}
          name={ctx.user.name}
          confirm={confirmCheckout}
          doneHref="/portal/billing?saved=Payment+received.+Your+plan+is+active."
        />
      ) : null}

      {usable && (
        <p className="text-sm">
          <Link href="/portal/billing" className="font-semibold text-teal-700 underline">
            Cancel and go back
          </Link>
        </p>
      )}
    </div>
  );
}
