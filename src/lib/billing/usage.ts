import type { PrismaClient } from "@/generated/prisma/client";
import { featuredInMonth, istToday, parseDay } from "@/lib/featured/service";

export type PlanUsage = {
  /** Projects that count against the limit: everything except archived ones. */
  projects: number;
  /** People in the company plus invitations waiting to be accepted. */
  seats: number;
  /** Featured days set in the current month. */
  featuredThisMonth: number;
};

export async function loadPlanUsage(
  db: PrismaClient,
  builderId: string,
  now: Date = new Date(),
): Promise<PlanUsage> {
  const [projects, members, invites, featuredThisMonth] = await Promise.all([
    db.project.count({ where: { builderId, status: { not: "ARCHIVED" } } }),
    db.builderMember.count({ where: { builderId } }),
    db.teamInvite.count({ where: { builderId, acceptedAt: null, expiresAt: { gt: now } } }),
    featuredInMonth(db, builderId, parseDay(istToday(now))!),
  ]);
  return { projects, seats: members + invites, featuredThisMonth };
}
