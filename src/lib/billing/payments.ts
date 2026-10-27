import type { PaymentOrder, PrismaClient, Prisma, Invoice } from "@/generated/prisma/client";
import type { BillingInterval, PlanCode } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { addInterval, formatPaise } from "@/lib/billing/money";
import { quoteChange, type CurrentPlan } from "@/lib/billing/quote";
import type { PaymentProvider } from "@/lib/billing/provider";
import {
  applyAssignment,
  resumeLapsedProjects,
  supplierFromEnv,
  type Supplier,
} from "@/lib/billing/subscriptions";
import { isInForce } from "@/lib/entitlements";
import { PLAN_LABELS } from "@/lib/plans";

// Taking a payment and turning it into a plan. The order records exactly what the company agreed to
// pay; settling it (from the webhook or from the return page, whichever comes first, and safely
// twice) sets the plan and writes the invoice in one transaction. See docs/BILLING.md.

type Tx = Prisma.TransactionClient;

export type CheckoutResult = { ok: true; order: PaymentOrder } | { ok: false; message: string };

/**
 * Starts a payment for a plan change. Only a change that has something to pay becomes an order;
 * scheduled changes and refusals are answered with a message. An earlier unpaid order is set aside,
 * so a company never has two live checkouts at once.
 */
export async function createCheckout(
  db: PrismaClient,
  input: {
    builderId: string;
    userId: string;
    plan: PlanCode;
    interval: BillingInterval;
    provider: PaymentProvider;
    supplier?: Supplier;
    now?: Date;
  },
): Promise<CheckoutResult> {
  const now = input.now ?? new Date();
  const supplier = input.supplier ?? supplierFromEnv();
  const [builder, subscription] = await Promise.all([
    db.builder.findUnique({
      where: { id: input.builderId },
      select: { status: true, state: true },
    }),
    db.subscription.findUnique({ where: { builderId: input.builderId } }),
  ]);
  if (!builder) return { ok: false, message: "That company was not found." };
  if (builder.status !== "VERIFIED") {
    return { ok: false, message: "A plan can be bought once your company is verified." };
  }

  const quote = quoteChange({
    current: subscription,
    target: { plan: input.plan, interval: input.interval },
    now,
    supplierState: supplier.state,
    customerState: builder.state,
  });
  if (quote.kind === "none") return { ok: false, message: quote.reason };
  if (quote.kind === "schedule") {
    return {
      ok: false,
      message: "That change takes effect at your next renewal. Nothing to pay now.",
    };
  }
  if (quote.gst.totalPaise <= 0) {
    return { ok: false, message: "There is nothing to pay for that change." };
  }

  const order = await db.$transaction(async (tx) => {
    await tx.paymentOrder.updateMany({
      where: { builderId: input.builderId, status: "CREATED" },
      data: { status: "EXPIRED" },
    });
    return tx.paymentOrder.create({
      data: {
        builderId: input.builderId,
        change: quote.change,
        plan: quote.plan,
        interval: quote.interval,
        listPaise: quote.listPaise,
        creditPaise: quote.creditPaise,
        subtotalPaise: quote.subtotalPaise,
        totalPaise: quote.gst.totalPaise,
        provider: input.provider.name,
        createdById: input.userId,
      },
    });
  });

  try {
    const created = await input.provider.createOrder({
      amountPaise: order.totalPaise,
      receipt: order.id,
      notes: { orderId: order.id, builderId: input.builderId },
    });
    const saved = await db.paymentOrder.update({
      where: { id: order.id },
      data: { providerOrderId: created.providerOrderId },
    });
    return { ok: true, order: saved };
  } catch (error) {
    console.error("Could not create the payment order", error);
    await db.paymentOrder.update({
      where: { id: order.id },
      data: { status: "FAILED", failureReason: "The gateway did not accept the order." },
    });
    return {
      ok: false,
      message: "The payment service could not be reached. Nothing was charged. Please try again.",
    };
  }
}

export type SettleResult =
  | {
      ok: true;
      /** True when this call did the work, false when the order was already settled. */
      settledNow: boolean;
      order: PaymentOrder;
      invoice: Invoice | null;
      resumedProjectIds: string[];
    }
  | { ok: false; code: "not_found" | "amount_mismatch" | "not_verified"; message: string };

/** The plan period a paid order buys, worked out at the moment of settling. */
function periodFor(order: PaymentOrder, current: CurrentPlan | null, now: Date) {
  if (order.change === "RENEW" && current && isInForce(current, now)) {
    const running = current.currentPeriodEnd.getTime() > now.getTime();
    const base = running ? current.currentPeriodEnd : now;
    return {
      periodStart: running ? current.currentPeriodStart : now,
      periodEnd: addInterval(base, order.interval),
      paidBefore: running ? current.paidSubtotalPaise : 0,
    };
  }
  return { periodStart: now, periodEnd: addInterval(now, order.interval), paidBefore: 0 };
}

/**
 * Marks an order paid and gives the company what it bought. Safe to call twice, and at once from
 * the webhook and the return page: the order row is locked, the second call finds it paid and does
 * nothing. A payment whose amount is not the order's amount is refused and recorded, never applied.
 */
export async function settleOrder(
  db: PrismaClient,
  input: {
    /** Our order id, or the gateway's. */
    orderId?: string;
    providerOrderId?: string;
    providerPaymentId: string;
    amountPaise: number;
    provider: "razorpay" | "test";
    supplier?: Supplier;
    now?: Date;
  },
): Promise<SettleResult> {
  const now = input.now ?? new Date();
  const supplier = input.supplier ?? supplierFromEnv();

  const found = await db.paymentOrder.findFirst({
    where: input.orderId
      ? { id: input.orderId }
      : { providerOrderId: input.providerOrderId ?? "__none__" },
    select: { id: true },
  });
  if (!found) return { ok: false, code: "not_found", message: "No such payment order." };

  const result = await db.$transaction(async (tx: Tx): Promise<SettleResult> => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentOrder" WHERE "id" = ${found.id} FOR UPDATE`;
    const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: found.id } });
    if (order.status === "PAID") {
      return { ok: true, settledNow: false, order, invoice: null, resumedProjectIds: [] };
    }
    if (order.provider !== input.provider) {
      return {
        ok: false,
        code: "not_verified",
        message: "That payment does not belong to this gateway.",
      };
    }
    if (input.amountPaise !== order.totalPaise) {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          failureReason: `Amount mismatch: expected ${order.totalPaise} paise, gateway reported ${input.amountPaise}.`,
        },
      });
      await recordAudit(tx, {
        actorId: null,
        action: "payment.amount_mismatch",
        entity: "Builder",
        entityId: order.builderId,
        meta: {
          orderId: order.id,
          expected: order.totalPaise,
          reported: input.amountPaise,
          paymentId: input.providerPaymentId,
        },
      });
      return {
        ok: false,
        code: "amount_mismatch",
        message: "The amount paid does not match the order.",
      };
    }

    const current = await tx.subscription.findUnique({ where: { builderId: order.builderId } });
    const period = periodFor(order, current, now);
    const description =
      order.creditPaise > 0
        ? `RKB Platform ${PLAN_LABELS[order.plan]} plan, ${order.interval === "ANNUAL" ? "annual" : "monthly"} (${formatPaise(order.listPaise)} less ${formatPaise(order.creditPaise)} credit for the unused part of the previous plan)`
        : undefined;
    const { invoice } = await applyAssignment(tx, {
      builderId: order.builderId,
      plan: order.plan,
      interval: order.interval,
      source: "GATEWAY",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      invoice: {
        subtotalPaise: order.subtotalPaise,
        paymentMethod: input.provider,
        paymentReference: input.providerPaymentId,
        description,
      },
      paidSubtotalPaise: period.paidBefore + order.subtotalPaise,
      actorId: order.createdById,
      supplier,
      now,
    });
    const settled = await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        providerPaymentId: input.providerPaymentId,
        paidAt: now,
        invoiceId: invoice?.id ?? null,
        failureReason: null,
      },
    });
    await recordAudit(tx, {
      actorId: order.createdById,
      action: "payment.settled",
      entity: "Builder",
      entityId: order.builderId,
      meta: { orderId: order.id, invoice: invoice?.number ?? null, totalPaise: order.totalPaise },
    });
    return { ok: true, settledNow: true, order: settled, invoice, resumedProjectIds: [] };
  });

  if (result.ok && result.settledNow) {
    result.resumedProjectIds = await resumeLapsedProjects(db, result.order.builderId, null);
  }
  return result;
}

/** The gateway said the attempt failed. The order stays open for another try, only marked. */
export async function markOrderFailed(
  db: PrismaClient,
  input: { providerOrderId: string; reason: string },
): Promise<void> {
  await db.paymentOrder.updateMany({
    where: { providerOrderId: input.providerOrderId, status: "CREATED" },
    data: { failureReason: input.reason.slice(0, 300) },
  });
}

/**
 * Refunds an invoice: the money goes back through the gateway when it was paid there, and the
 * invoice is marked refunded. Access to the plan is not changed here (staff decide that
 * separately). Whether a credit note is needed is a matter for your CA.
 */
export async function refundInvoice(
  db: PrismaClient,
  input: {
    invoiceId: string;
    note: string;
    actorId: string;
    provider: PaymentProvider | null;
    now?: Date;
  },
): Promise<{ ok: true; gatewayRefundId: string | null } | { ok: false; message: string }> {
  const now = input.now ?? new Date();
  const invoice = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) return { ok: false, message: "That invoice was not found." };
  if (invoice.status !== "PAID")
    return { ok: false, message: "Only a paid invoice can be refunded." };

  let gatewayRefundId: string | null = null;
  if (invoice.paymentMethod === "razorpay" || invoice.paymentMethod === "test") {
    if (!input.provider || input.provider.name !== invoice.paymentMethod) {
      return {
        ok: false,
        message:
          "This payment was taken online, and the online gateway is not set up to refund it.",
      };
    }
    if (!invoice.paymentReference) {
      return {
        ok: false,
        message: "The payment reference is missing, so it cannot be refunded online.",
      };
    }
    // Claim the invoice first, so two clicks never refund twice.
    const claimed = await db.invoice.updateMany({
      where: { id: invoice.id, status: "PAID" },
      data: { status: "REFUNDED", refundedAt: now, refundNote: input.note },
    });
    if (claimed.count !== 1) return { ok: false, message: "That invoice was already refunded." };
    try {
      gatewayRefundId = (
        await input.provider.refund({
          paymentId: invoice.paymentReference,
          amountPaise: invoice.totalPaise,
        })
      ).refundId;
    } catch (error) {
      console.error("Gateway refund failed", error);
      await db.invoice.updateMany({
        where: { id: invoice.id, status: "REFUNDED" },
        data: { status: "PAID", refundedAt: null, refundNote: null },
      });
      return {
        ok: false,
        message: "The gateway could not refund the payment. Nothing was changed.",
      };
    }
  } else {
    const claimed = await db.invoice.updateMany({
      where: { id: invoice.id, status: "PAID" },
      data: { status: "REFUNDED", refundedAt: now, refundNote: input.note },
    });
    if (claimed.count !== 1) return { ok: false, message: "That invoice was already refunded." };
  }
  await recordAudit(db, {
    actorId: input.actorId,
    action: "invoice.refunded",
    entity: "Builder",
    entityId: invoice.builderId,
    meta: {
      invoice: invoice.number,
      totalPaise: invoice.totalPaise,
      gatewayRefundId,
      note: input.note,
    },
  });
  return { ok: true, gatewayRefundId };
}
