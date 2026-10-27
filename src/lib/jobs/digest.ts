import type { PrismaClient } from "@/generated/prisma/client";
import { builderRecipients } from "@/lib/leads/service";
import { OPEN_STATUSES } from "@/lib/leads/status";
import { sendMail, type MailMessage } from "@/lib/mail";
import { dailyDigestMail } from "@/lib/mail/templates";

type Send = (message: MailMessage) => Promise<void>;

const HOUR = 3_600_000;
/** A company gets at most one summary in this many hours, however often the job runs. */
const MIN_GAP_HOURS = 20;

/**
 * Emails each verified company a short summary of the enquiries that arrived since the last one.
 * Nothing is sent to a company with no new enquiries. Safe to run twice: the company is claimed
 * (its last-summary time is set only if it is old enough) before anything is sent.
 */
export async function sendDailyDigests(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ emails: number }> {
  const oldEnough = new Date(now.getTime() - MIN_GAP_HOURS * HOUR);
  const candidates = await db.builder.findMany({
    where: {
      status: "VERIFIED",
      leads: { some: { createdAt: { gt: new Date(now.getTime() - 48 * HOUR) } } },
      OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: oldEnough } }],
    },
    select: { id: true, companyName: true, lastDigestAt: true },
    take: 1000,
  });

  let emails = 0;
  for (const builder of candidates) {
    const since = builder.lastDigestAt ?? new Date(now.getTime() - 24 * HOUR);
    const newLeads = await db.lead.count({
      where: { builderId: builder.id, createdAt: { gt: since, lte: now } },
    });
    if (newLeads === 0) continue;

    const won = await db.builder.updateMany({
      where: { id: builder.id, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: oldEnough } }] },
      data: { lastDigestAt: now },
    });
    if (won.count !== 1) continue; // another run took it

    const [stillNew, followUpsDue, to] = await Promise.all([
      db.lead.count({ where: { builderId: builder.id, status: "NEW" } }),
      db.lead.count({
        where: {
          builderId: builder.id,
          status: { in: [...OPEN_STATUSES] },
          followUpAt: { lte: now },
        },
      }),
      builderRecipients(db, builder.id),
    ]);
    if (to.length === 0) continue;
    await send({
      to,
      ...dailyDigestMail({ companyName: builder.companyName, newLeads, stillNew, followUpsDue }),
    });
    emails++;
  }
  return { emails };
}
