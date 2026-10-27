import type { Prisma } from "@/generated/prisma/client";
import type { PlanCode } from "@/generated/prisma/enums";
import { GRACE_DAYS, LIMITS, type Limits } from "@/lib/entitlements";

const DAY = 86_400_000;
const ORDER: PlanCode[] = ["STARTER", "GROWTH", "PREMIER"];

/** The plans whose limits satisfy a test, for database queries that must follow the plan. */
export function planCodesWith(test: (limits: Limits) => boolean): PlanCode[] {
  return ORDER.filter((code) => test(LIMITS[code]));
}

/** The database form of `isInForce`: an active subscription, still inside its period plus grace. */
export function inForceWhere(now: Date = new Date()): Prisma.SubscriptionWhereInput {
  return {
    status: "ACTIVE",
    currentPeriodEnd: { gte: new Date(now.getTime() - GRACE_DAYS * DAY) },
  };
}

/** Companies on a plan in force that satisfies a test. */
export function builderPlanWhere(
  test: (limits: Limits) => boolean,
  now: Date = new Date(),
): Prisma.BuilderWhereInput {
  return {
    subscription: { is: { ...inForceWhere(now), plan: { in: planCodesWith(test) } } },
  };
}
