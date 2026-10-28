import type { PrismaClient } from "@/generated/prisma/client";
import type { PlanCode } from "@/generated/prisma/enums";

// What a company may do, in one place. Every limit and every gated feature in the product reads
// from here (never from the plan's name), so a rule changes in exactly one place. The marketing
// table in plans.ts is checked against these limits by a test, so the two cannot disagree.
// See docs/ROADMAP-7-10.md.

export type Entitlements = {
  /** The plan the company is on right now, or null when it has none. */
  plan: PlanCode | null;
  /** Whether a paid plan is in force (paid up, or in its short grace period). */
  active: boolean;
  /** null means unlimited. */
  maxProjects: number | null;
  maxPhotosPerProject: number;
  video: boolean;
  tour360: boolean;
  /** People in the company, the owner included. */
  teamSeats: number;
  /** Basic: see and move leads. Full: also follow-ups and reminders, site visits and CSV export. */
  leads: "basic" | "full";
  layoutMap: boolean;
  analytics: "none" | "advanced" | "export";
  featuredDaysPerMonth: number;
  priorityListing: boolean;
  homepageSpotlight: boolean;
};

export type Limits = Omit<Entitlements, "plan" | "active">;

export const LIMITS: Record<PlanCode, Limits> = {
  STARTER: {
    maxProjects: 2,
    maxPhotosPerProject: 15,
    video: false,
    tour360: false,
    teamSeats: 1,
    leads: "basic",
    layoutMap: false,
    analytics: "none",
    featuredDaysPerMonth: 0,
    priorityListing: false,
    homepageSpotlight: false,
  },
  GROWTH: {
    maxProjects: 6,
    maxPhotosPerProject: 40,
    video: true,
    tour360: false,
    teamSeats: 3,
    leads: "full",
    layoutMap: true,
    analytics: "advanced",
    featuredDaysPerMonth: 2,
    priorityListing: false,
    homepageSpotlight: false,
  },
  PREMIER: {
    maxProjects: null,
    maxPhotosPerProject: 40,
    video: true,
    tour360: true,
    teamSeats: 10,
    leads: "full",
    layoutMap: true,
    analytics: "export",
    featuredDaysPerMonth: 0,
    priorityListing: true,
    homepageSpotlight: true,
  },
};

/**
 * A company with no plan (never bought one, or its plan ended) is on the free tier: it can publish
 * projects like anyone else, at the smallest size. A plan adds room and features; it is never needed
 * to go live.
 */
const NO_PLAN: Limits = { ...LIMITS.STARTER };

/** After a plan's paid period ends, it stays in force this long, so a late payment is not a cliff. */
export const GRACE_DAYS = 3;
const DAY = 86_400_000;

export function entitlementsForPlan(plan: PlanCode | null): Entitlements {
  if (!plan) return { plan: null, active: false, ...NO_PLAN };
  return { plan, active: true, ...LIMITS[plan] };
}

/** Whether a subscription is in force at a moment: active, and not past its period plus grace. */
export function isInForce(
  subscription: { status: string; currentPeriodEnd: Date } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!subscription || subscription.status !== "ACTIVE") return false;
  return subscription.currentPeriodEnd.getTime() + GRACE_DAYS * DAY >= now.getTime();
}

/** What this company may do right now, from its subscription. */
export async function entitlementsForBuilder(
  db: PrismaClient,
  builderId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const subscription = await db.subscription.findUnique({
    where: { builderId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  });
  return entitlementsForPlan(isInForce(subscription, now) ? subscription!.plan : null);
}

/** Why something is not available, and which plan unlocks it, for the upgrade prompts. */
export function cheapestPlanWith(test: (limits: Limits) => boolean): PlanCode | null {
  const order: PlanCode[] = ["STARTER", "GROWTH", "PREMIER"];
  return order.find((code) => test(LIMITS[code])) ?? null;
}
