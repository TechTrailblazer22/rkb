import type { PrismaClient } from "@/generated/prisma/client";
import { builderPlanWhere } from "@/lib/billing/where";
import { builderRecipients } from "@/lib/leads/service";
import { OPEN_STATUSES } from "@/lib/leads/status";
import { sendMail, type MailMessage } from "@/lib/mail";
import { followUpDueMail } from "@/lib/mail/templates";

type Send = (message: MailMessage) => Promise<void>;

/**
 * Emails each company the enquiries whose follow-up date has arrived, one email per company.
 *
 * Only companies whose plan includes the full lead dashboard are reminded.
 *
 * Safe to run twice, or twice at once: each lead is claimed first (its reminder marker is set only
 * if it was still empty), and only claimed leads are mentioned. Changing a lead's follow-up date
 * clears the marker, so the new date gets its own reminder.
 */
export async function sendFollowUpReminders(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ leads: number; emails: number }> {
  const due = await db.lead.findMany({
    where: {
      followUpAt: { lte: now },
      reminderSentAt: null,
      status: { in: [...OPEN_STATUSES] },
      // Follow-up reminders are part of the full lead dashboard (Growth and Premier).
      builder: builderPlanWhere((limits) => limits.leads === "full", now),
    },
    select: { id: true, name: true, builderId: true, project: { select: { name: true } } },
    orderBy: { followUpAt: "asc" },
    take: 1000,
  });

  const byBuilder = new Map<string, { id: string; name: string; projectName: string }[]>();
  let claimed = 0;
  for (const lead of due) {
    const won = await db.lead.updateMany({
      where: { id: lead.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (won.count !== 1) continue; // another run took it
    claimed++;
    const list = byBuilder.get(lead.builderId) ?? [];
    list.push({ id: lead.id, name: lead.name, projectName: lead.project.name });
    byBuilder.set(lead.builderId, list);
  }

  let emails = 0;
  for (const [builderId, leads] of byBuilder) {
    const builder = await db.builder.findUnique({
      where: { id: builderId },
      select: { companyName: true },
    });
    const to = await builderRecipients(db, builderId);
    if (to.length === 0) continue;
    await send({ to, ...followUpDueMail({ companyName: builder?.companyName ?? null, leads }) });
    emails++;
  }
  return { leads: claimed, emails };
}
