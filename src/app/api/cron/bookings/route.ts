import { parseAdminEmails } from "@/lib/auth/roles";
import { hasProblems, reconcileBookings, releaseExpiredHolds } from "@/lib/booking/service";
import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { bookingReconciliationMail } from "@/lib/mail/templates";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

export const dynamic = "force-dynamic";

// Run every five minutes (see docs/BOOKING.md). Releases holds that ran out, so a plot is never
// stuck, then checks that payments and plots agree. Staff are emailed about a mismatch at most once
// a day (in the first five minutes of 03:00 UTC), so a five-minute job does not email every time.
export const { GET, POST } = cronRoute("bookings", async () => {
  const db = getDb();
  const released = await releaseExpiredHolds(db);
  if (released.released > 0) {
    // The public pages show held plots as booked: refresh them now that some are free again.
    const projects = await db.project.findMany({
      where: { status: "LIVE", plots: { some: { status: "AVAILABLE" } } },
      select: { id: true },
      take: 50,
    });
    for (const { id } of projects) await revalidateProjectPages(db, id);
  }
  const report = await reconcileBookings(db);
  const now = new Date();
  const dailySlot = now.getUTCHours() === 3 && now.getUTCMinutes() < 5;
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS);
  let emailed = false;
  if (hasProblems(report) && dailySlot && admins.length > 0) {
    await sendMail({
      to: admins,
      ...bookingReconciliationMail({
        lines: [
          `Paid bookings whose plot is not Booked: ${report.paidButPlotFree.length}.`,
          `Plots shown as held with no hold: ${report.heldWithoutBooking.length}.`,
          `Holds that ran out but were not released: ${report.staleHolds.length}.`,
          `Tokens waiting to be refunded: ${report.refundDue.length}.`,
        ],
      }),
    });
    emailed = true;
  }
  return { released: released.released, problems: hasProblems(report), ...report, emailed };
});
