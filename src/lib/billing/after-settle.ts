import type { PrismaClient } from "@/generated/prisma/client";
import { formatPaise } from "@/lib/billing/money";
import { builderRecipients } from "@/lib/leads/service";
import { sendMail } from "@/lib/mail";
import { paymentReceiptMail } from "@/lib/mail/templates";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

/**
 * What follows a payment that was just settled: the receipt goes to the company, and the public
 * pages of the company's live projects are refreshed (some may have just come back). Call it only when this call did the
 * settling (not when the order was already settled), so the receipt is sent once.
 */
export async function afterSettled(db: PrismaClient, orderId: string): Promise<void> {
  try {
    const order = await db.paymentOrder.findUnique({
      where: { id: orderId },
      select: {
        builderId: true,
        plan: true,
        invoiceId: true,
        totalPaise: true,
        builder: {
          select: { companyName: true, subscription: { select: { currentPeriodEnd: true } } },
        },
      },
    });
    if (!order) return;
    // A project that went live again must show on the cached public pages straight away.
    const live = await db.project.findMany({
      where: { builderId: order.builderId, status: "LIVE" },
      select: { id: true },
      take: 50,
    });
    for (const { id } of live) await revalidateProjectPages(db, id);
    if (!order.invoiceId || !order.builder.subscription) return;
    const invoice = await db.invoice.findUnique({
      where: { id: order.invoiceId },
      select: { number: true, id: true },
    });
    const to = await builderRecipients(db, order.builderId);
    if (!invoice || to.length === 0) return;
    await sendMail({
      to,
      ...paymentReceiptMail({
        companyName: order.builder.companyName,
        plan: order.plan,
        invoiceNumber: invoice.number,
        totalText: formatPaise(order.totalPaise),
        paidUntil: order.builder.subscription.currentPeriodEnd,
        invoiceId: invoice.id,
      }),
    });
  } catch (error) {
    // The payment is already recorded; a failed email must never undo or hide that.
    console.error("Could not send the payment receipt", error);
  }
}
