import type { PrismaClient } from "@/generated/prisma/client";
import type { BillingInterval, PlanCode } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { LIMITS } from "@/lib/entitlements";
import { PLAN_LABELS } from "@/lib/plans";

// Changes that cost nothing now: moving to a cheaper plan at the next renewal, and not renewing.
// A downgrade is refused while the company is over the new plan's limits, and says exactly what to
// reduce, so nothing the company has built is ever silently hidden or deleted.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What stands in the way of being on this plan, in plain words. Empty when nothing does. */
export async function limitBlockers(
  db: PrismaClient,
  builderId: string,
  plan: PlanCode,
  now: Date = new Date(),
): Promise<string[]> {
  const target = LIMITS[plan];
  const label = PLAN_LABELS[plan];
  const blockers: string[] = [];

  const projects = await db.project.findMany({
    where: { builderId, status: { not: "ARCHIVED" } },
    select: {
      name: true,
      videoUrl: true,
      tourUrl: true,
      _count: { select: { media: { where: { kind: "PHOTO" } } } },
    },
  });
  if (target.maxProjects !== null && projects.length > target.maxProjects) {
    blockers.push(
      `You have ${plural(projects.length, "project")} and ${label} allows ${target.maxProjects}. Archive ${plural(projects.length - target.maxProjects, "project")} you no longer need.`,
    );
  }
  for (const project of projects) {
    if (project._count.media > target.maxPhotosPerProject) {
      blockers.push(
        `"${project.name}" has ${plural(project._count.media, "photo")} and ${label} allows ${target.maxPhotosPerProject} per project. Remove ${plural(project._count.media - target.maxPhotosPerProject, "photo")}.`,
      );
    }
  }
  if (!target.video) {
    const withVideo = projects.filter((p) => p.videoUrl);
    if (withVideo.length > 0) {
      blockers.push(
        `${label} does not include video, and ${plural(withVideo.length, "project")} use${withVideo.length === 1 ? "s" : ""} it (${withVideo.map((p) => `"${p.name}"`).join(", ")}). Remove the video link.`,
      );
    }
  }
  if (!target.tour360) {
    const withTour = projects.filter((p) => p.tourUrl);
    if (withTour.length > 0) {
      blockers.push(
        `${label} does not include a 360° tour, and ${plural(withTour.length, "project")} use${withTour.length === 1 ? "s" : ""} one (${withTour.map((p) => `"${p.name}"`).join(", ")}). Remove the tour link.`,
      );
    }
  }

  const [members, invites] = await Promise.all([
    db.builderMember.count({ where: { builderId } }),
    db.teamInvite.count({ where: { builderId, acceptedAt: null, expiresAt: { gt: now } } }),
  ]);
  if (members + invites > target.teamSeats) {
    blockers.push(
      `Your team has ${plural(members, "person", "people")}${invites ? ` and ${plural(invites, "invitation")} waiting` : ""}, and ${label} has ${plural(target.teamSeats, "seat")}. Remove ${plural(members + invites - target.teamSeats, "seat")} first.`,
    );
  }

  // Featured days already booked for coming months must fit the new monthly allowance.
  if (!target.priorityListing) {
    const upcoming = await db.featuredDay.findMany({
      where: { builderId, day: { gte: new Date(now.toISOString().slice(0, 10)) } },
      select: { day: true },
    });
    const perMonth = new Map<string, number>();
    for (const { day } of upcoming) {
      const key = day.toISOString().slice(0, 7);
      perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    }
    for (const [month, count] of [...perMonth].sort()) {
      if (count > target.featuredDaysPerMonth) {
        blockers.push(
          `You have ${plural(count, "featured day")} booked in ${month} and ${label} allows ${target.featuredDaysPerMonth} a month. Take some back on the Promote page.`,
        );
      }
    }
  }
  return blockers;
}

export type ChangeResult = { ok: true } | { ok: false; message: string; blockers?: string[] };

/** Asks for a change that takes effect at the end of the paid period. */
export async function scheduleChange(
  db: PrismaClient,
  input: {
    builderId: string;
    actorId: string;
    plan: PlanCode;
    interval: BillingInterval;
    now?: Date;
  },
): Promise<ChangeResult> {
  const now = input.now ?? new Date();
  const subscription = await db.subscription.findUnique({ where: { builderId: input.builderId } });
  if (!subscription || subscription.status !== "ACTIVE") {
    return { ok: false, message: "There is no running plan to change." };
  }
  const blockers = await limitBlockers(db, input.builderId, input.plan, now);
  if (blockers.length > 0) {
    return {
      ok: false,
      message: `You cannot move to ${PLAN_LABELS[input.plan]} yet.`,
      blockers,
    };
  }
  await db.subscription.update({
    where: { builderId: input.builderId },
    data: { pendingPlan: input.plan, pendingInterval: input.interval },
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "subscription.change_scheduled",
    entity: "Builder",
    entityId: input.builderId,
    meta: { plan: input.plan, interval: input.interval },
  });
  return { ok: true };
}

export async function clearScheduledChange(
  db: PrismaClient,
  input: { builderId: string; actorId: string },
): Promise<void> {
  await db.subscription.updateMany({
    where: { builderId: input.builderId },
    data: { pendingPlan: null, pendingInterval: null },
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "subscription.change_cleared",
    entity: "Builder",
    entityId: input.builderId,
  });
}

/** Keeps the plan to the end of the period, then lets it end (no further reminders to renew). */
export async function setCancelAtPeriodEnd(
  db: PrismaClient,
  input: { builderId: string; actorId: string; cancel: boolean },
): Promise<boolean> {
  const changed = await db.subscription.updateMany({
    where: { builderId: input.builderId, status: "ACTIVE" },
    data: { cancelAtPeriodEnd: input.cancel },
  });
  if (changed.count !== 1) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: input.cancel ? "subscription.cancel_requested" : "subscription.cancel_withdrawn",
    entity: "Builder",
    entityId: input.builderId,
  });
  return true;
}
