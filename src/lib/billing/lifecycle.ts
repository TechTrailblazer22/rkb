import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { GRACE_DAYS } from "@/lib/entitlements";
import { builderRecipients } from "@/lib/leads/service";
import { sendMail, type MailMessage } from "@/lib/mail";
import { planEndingMail, planLapsedMail } from "@/lib/mail/templates";

type Send = (message: MailMessage) => Promise<void>;

const DAY = 86_400_000;
/** Remind the company at these many days before its plan ends. Each reminder is sent once. */
const REMIND_AT = [7, 3, 1];

/**
 * Ends the plans whose period and grace are over, and takes that company's live projects offline
 * (paused, remembering why, so they come back by themselves when the plan does). Data is kept.
 * Safe to run twice: a subscription is claimed by changing its status, and a project is paused
 * only if it is still live.
 */
export async function expireSubscriptions(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ expired: number; pausedProjectIds: string[] }> {
  const due = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      currentPeriodEnd: { lt: new Date(now.getTime() - GRACE_DAYS * DAY) },
    },
    select: { id: true, builderId: true, plan: true, currentPeriodEnd: true },
    take: 1000,
  });

  let expired = 0;
  const pausedProjectIds: string[] = [];
  for (const subscription of due) {
    const won = await db.subscription.updateMany({
      where: { id: subscription.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    if (won.count !== 1) continue;
    expired++;

    const live = await db.project.findMany({
      where: { builderId: subscription.builderId, status: "LIVE" },
      select: { id: true },
    });
    const note = `The ${subscription.plan.toLowerCase()} plan ended on ${subscription.currentPeriodEnd.toISOString().slice(0, 10)}. Your projects are offline and will go live again as soon as you renew.`;
    const ids: string[] = [];
    for (const { id } of live) {
      const paused = await db.project.updateMany({
        where: { id, status: "LIVE" },
        data: { status: "PAUSED", pauseReason: "PLAN_LAPSED", reviewNote: note, reviewedAt: now },
      });
      if (paused.count !== 1) continue;
      ids.push(id);
      await recordAudit(db, {
        actorId: null,
        action: "project.paused_plan_lapsed",
        entity: "Project",
        entityId: id,
        meta: { subscriptionId: subscription.id },
      });
    }
    pausedProjectIds.push(...ids);

    await recordAudit(db, {
      actorId: null,
      action: "subscription.expired",
      entity: "Builder",
      entityId: subscription.builderId,
      meta: { plan: subscription.plan, paused: ids.length },
    });
    const builder = await db.builder.findUnique({
      where: { id: subscription.builderId },
      select: { companyName: true },
    });
    const to = await builderRecipients(db, subscription.builderId);
    if (to.length > 0) {
      await send({
        to,
        ...planLapsedMail({
          companyName: builder?.companyName ?? null,
          plan: subscription.plan,
          projectsPaused: ids.length,
        }),
      });
    }
  }
  return { expired, pausedProjectIds };
}

/**
 * Emails the company 7, 3 and 1 days before its plan ends (or, if it chose not to renew, tells it
 * the end date). Each step is sent once: the step is claimed before the email goes out.
 */
export async function sendRenewalReminders(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ reminded: number }> {
  const soon = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      currentPeriodEnd: { gte: now, lt: new Date(now.getTime() + (REMIND_AT[0] + 1) * DAY) },
    },
    select: {
      id: true,
      builderId: true,
      plan: true,
      currentPeriodEnd: true,
      lastReminderDays: true,
      cancelAtPeriodEnd: true,
    },
    take: 1000,
  });

  let reminded = 0;
  for (const subscription of soon) {
    const daysLeft = Math.ceil((subscription.currentPeriodEnd.getTime() - now.getTime()) / DAY);
    const step = REMIND_AT.slice()
      .reverse()
      .find((days) => daysLeft <= days);
    if (step === undefined) continue;
    if (subscription.lastReminderDays !== null && subscription.lastReminderDays <= step) continue;

    const won = await db.subscription.updateMany({
      where: {
        id: subscription.id,
        OR: [{ lastReminderDays: null }, { lastReminderDays: { gt: step } }],
      },
      data: { lastReminderDays: step },
    });
    if (won.count !== 1) continue;

    const builder = await db.builder.findUnique({
      where: { id: subscription.builderId },
      select: { companyName: true },
    });
    const to = await builderRecipients(db, subscription.builderId);
    if (to.length === 0) continue;
    await send({
      to,
      ...planEndingMail({
        companyName: builder?.companyName ?? null,
        plan: subscription.plan,
        daysLeft,
        endsOn: subscription.currentPeriodEnd,
        willNotRenew: subscription.cancelAtPeriodEnd,
      }),
    });
    reminded++;
  }
  return { reminded };
}
