import type { PrismaClient } from "@/generated/prisma/client";
import { formatPaise } from "@/lib/billing/money";
import { parseAdminEmails } from "@/lib/auth/roles";
import { builderRecipients } from "@/lib/leads/service";
import { sendMail } from "@/lib/mail";
import {
  bookingPaidBuilderMail,
  bookingPaidBuyerMail,
  bookingRefundDueMail,
  bookingRefundedMail,
} from "@/lib/mail/templates";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

/**
 * What follows a settled token payment or a refund: the right people are told and the public
 * project page is refreshed (a plot just changed hands). Mail never fails the payment.
 */
export async function afterBookingChange(
  db: PrismaClient,
  bookingId: string,
  kind: "paid" | "refund_due" | "refunded",
): Promise<void> {
  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        plotNumber: true,
        tokenPaise: true,
        buyerName: true,
        buyerMobile: true,
        note: true,
        projectId: true,
        builderId: true,
        buyer: { select: { email: true } },
        project: { select: { name: true, builder: { select: { companyName: true } } } },
      },
    });
    if (!booking) return;
    await revalidateProjectPages(db, booking.projectId);
    const tokenText = formatPaise(booking.tokenPaise);
    const base = { projectName: booking.project.name, plotNumber: booking.plotNumber, tokenText };
    if (kind === "paid") {
      await sendMail({
        to: booking.buyer.email,
        ...bookingPaidBuyerMail({
          ...base,
          companyName: booking.project.builder.companyName,
          bookingId: booking.id,
        }),
      });
      const to = await builderRecipients(db, booking.builderId);
      if (to.length > 0) {
        await sendMail({
          to,
          ...bookingPaidBuilderMail({
            ...base,
            buyerName: booking.buyerName,
            buyerMobile: booking.buyerMobile,
          }),
        });
      }
    } else if (kind === "refund_due") {
      const admins = parseAdminEmails(process.env.ADMIN_EMAILS);
      if (admins.length > 0) {
        await sendMail({ to: admins, ...bookingRefundDueMail({ ...base, reason: booking.note }) });
      }
    } else {
      await sendMail({
        to: booking.buyer.email,
        ...bookingRefundedMail({ ...base, note: booking.note ?? "Refunded." }),
      });
    }
  } catch (error) {
    console.error("Could not send booking emails", error);
  }
}
