import type { PrismaClient } from "@/generated/prisma/client";
import { statsForBuilder } from "@/lib/analytics/stats";
import { builderPlanWhere } from "@/lib/billing/where";
import { istToday, parseDay } from "@/lib/featured/service";
import { builderRecipients } from "@/lib/leads/service";
import { sendMail, type MailMessage } from "@/lib/mail";
import { performanceMail } from "@/lib/mail/templates";

type Send = (message: MailMessage) => Promise<void>;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

/** The Indian calendar month before today: its "YYYY-MM" key, its last day and its length. */
export function previousMonth(now: Date) {
  const today = parseDay(istToday(now))!;
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return {
    key: lastDay.toISOString().slice(0, 7),
    lastDay,
    days: lastDay.getUTCDate(),
    label: lastDay.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/**
 * Emails each company on a plan with analytics a summary of last month. Run it daily or monthly:
 * a company is recorded as reported for the month before its email goes out, so it gets one email
 * however often (or at once) the job runs.
 */
export async function sendMonthlyReports(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ reported: number }> {
  const month = previousMonth(now);
  const builders = await db.builder.findMany({
    where: {
      status: "VERIFIED",
      reports: { none: { month: month.key } },
      ...builderPlanWhere((limits) => limits.analytics !== "none", now),
    },
    select: { id: true, companyName: true },
    take: 500,
  });

  let reported = 0;
  for (const builder of builders) {
    try {
      await db.performanceReport.create({ data: { builderId: builder.id, month: month.key } });
    } catch (error) {
      if (isUniqueViolation(error)) continue; // another run got there first
      throw error;
    }
    const to = await builderRecipients(db, builder.id);
    if (to.length === 0) continue;
    const stats = await statsForBuilder(db, builder.id, {
      days: month.days,
      endDay: month.lastDay,
    });
    const top = [...stats.perProject].sort((a, b) => b.totals.VIEW - a.totals.VIEW)[0];
    await send({
      to,
      ...performanceMail({
        companyName: builder.companyName,
        monthLabel: month.label,
        views: stats.totals.VIEW,
        enquiries: stats.totals.ENQUIRY,
        contacts: stats.totals.CALL + stats.totals.WHATSAPP,
        saved: stats.totals.SHORTLIST,
        topProject: top ? { name: top.name, views: top.totals.VIEW } : null,
      }),
    });
    reported++;
  }
  return { reported };
}
