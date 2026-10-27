"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { afterSettled } from "@/lib/billing/after-settle";
import { clearScheduledChange, scheduleChange, setCancelAtPeriodEnd } from "@/lib/billing/changes";
import { createCheckout, settleOrder } from "@/lib/billing/payments";
import { billingConfig, providerFor, type PaymentProvider } from "@/lib/billing/provider";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";

// Every action here is the owner's, finds the company from the logged-in user (never from the
// form), and re-checks everything on the server: the forms only carry a plan, a billing period and
// an order id, and the order must belong to this company.

const PLANS = ["STARTER", "GROWTH", "PREMIER"] as const;
const INTERVALS = ["MONTHLY", "ANNUAL"] as const;

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};
const owner = () => requireBuilderContext("/portal/billing", { ownerOnly: true });

function back(message: { saved?: string; error?: string; blockers?: string[] }): never {
  const params = new URLSearchParams();
  if (message.saved) params.set("saved", message.saved);
  if (message.error) params.set("error", message.error);
  // A few lines at most: the address must stay short.
  if (message.blockers?.length) params.set("blockers", message.blockers.join("\n").slice(0, 1200));
  redirect(`/portal/billing?${params.toString()}`);
}

function gateway(): PaymentProvider | null {
  try {
    return providerFor(billingConfig());
  } catch (error) {
    console.error("Billing is misconfigured", error);
    return null;
  }
}

function target(formData: FormData) {
  const plan = PLANS.find((p) => p === text(formData, "plan"));
  const interval = INTERVALS.find((i) => i === text(formData, "interval"));
  if (!plan || !interval) back({ error: "Choose a plan and how you want to pay." });
  return { plan, interval };
}

/** The company chose a plan to pay for: make the order and go to the payment page. */
export async function startCheckout(formData: FormData) {
  const ctx = await owner();
  const { plan, interval } = target(formData);
  const provider = gateway();
  if (!provider) back({ error: "Online payment is not available yet. Please contact us." });

  const result = await createCheckout(getDb(), {
    builderId: ctx.builder.id,
    userId: ctx.user.id,
    plan,
    interval,
    provider,
  });
  if (!result.ok) back({ error: result.message });
  redirect(`/portal/billing/pay/${result.order.id}`);
}

/** A change that waits for the renewal: a cheaper plan, or annual to monthly. */
export async function requestScheduledChange(formData: FormData) {
  const ctx = await owner();
  const { plan, interval } = target(formData);
  const result = await scheduleChange(getDb(), {
    builderId: ctx.builder.id,
    actorId: ctx.user.id,
    plan,
    interval,
  });
  revalidatePath("/portal/billing");
  if (!result.ok) back({ error: result.message, blockers: result.blockers });
  back({ saved: "Done. The change takes effect when your current period ends." });
}

export async function withdrawScheduledChange() {
  const ctx = await owner();
  await clearScheduledChange(getDb(), { builderId: ctx.builder.id, actorId: ctx.user.id });
  revalidatePath("/portal/billing");
  back({ saved: "The scheduled change was withdrawn." });
}

export async function cancelRenewal() {
  const ctx = await owner();
  const ok = await setCancelAtPeriodEnd(getDb(), {
    builderId: ctx.builder.id,
    actorId: ctx.user.id,
    cancel: true,
  });
  revalidatePath("/portal/billing");
  back(
    ok
      ? { saved: "Your plan will not renew. It stays active until the end of the paid period." }
      : { error: "There is no running plan to cancel." },
  );
}

export async function keepPlan() {
  const ctx = await owner();
  await setCancelAtPeriodEnd(getDb(), {
    builderId: ctx.builder.id,
    actorId: ctx.user.id,
    cancel: false,
  });
  revalidatePath("/portal/billing");
  back({ saved: "Cancellation withdrawn. Your plan stays as it is." });
}

// ---------------------------------------------------------------------------------------
// payment

export type PaymentConfirmation = { ok: true } | { ok: false; message: string };

async function ownOrder(orderId: string, builderId: string) {
  return getDb().paymentOrder.findFirst({ where: { id: orderId, builderId } });
}

/**
 * The browser says the payment went through. It is believed only after the gateway's signature on
 * (order id, payment id) checks out; the webhook is the other, equally idempotent way in.
 */
export async function confirmCheckout(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<PaymentConfirmation> {
  const ctx = await owner();
  const provider = gateway();
  const order = await ownOrder(orderId, ctx.builder.id);
  if (!provider || !order?.providerOrderId) {
    return {
      ok: false,
      message: "We could not match this payment. If money was taken, it will be applied shortly.",
    };
  }
  const valid = provider.verifyCheckoutSignature({
    providerOrderId: order.providerOrderId,
    paymentId: String(paymentId),
    signature: String(signature),
  });
  if (!valid) {
    return {
      ok: false,
      message: "We could not verify this payment. If money was taken, it will be applied shortly.",
    };
  }
  const db = getDb();
  const result = await settleOrder(db, {
    orderId: order.id,
    providerPaymentId: String(paymentId),
    amountPaise: order.totalPaise,
    provider: provider.name,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.settledNow) await afterSettled(db, order.id);
  revalidatePath("/portal", "layout");
  return { ok: true };
}

/**
 * The stand-in payment, for the test gateway only: it plays the part of a customer paying, so the
 * whole flow can be tried without a bank. Refused in any other mode.
 */
export async function payWithTestGateway(formData: FormData) {
  const ctx = await owner();
  const provider = gateway();
  if (provider?.name !== "test") back({ error: "Test payment is not available." });
  const order = await ownOrder(text(formData, "orderId"), ctx.builder.id);
  if (!order) back({ error: "That payment was not found." });

  const db = getDb();
  const result = await settleOrder(db, {
    orderId: order.id,
    providerPaymentId: `pay_test_${randomBytes(6).toString("hex")}`,
    amountPaise: order.totalPaise,
    provider: "test",
  });
  if (!result.ok) back({ error: result.message });
  if (result.settledNow) await afterSettled(db, order.id);
  revalidatePath("/portal", "layout");
  back({ saved: "Payment received. Your plan is active." });
}
