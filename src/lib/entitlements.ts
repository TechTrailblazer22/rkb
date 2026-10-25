import type { PlanCode } from "@/generated/prisma/enums";

// What a plan allows. Every project and upload limit is read from here, so Phase 7 (billing)
// changes one function, not every page. Limits come from the proposal's plan table.
export type Entitlements = {
  /** null means unlimited. */
  maxProjects: number | null;
  maxPhotosPerProject: number;
  video: boolean;
};

const LIMITS: Record<PlanCode, Entitlements> = {
  STARTER: { maxProjects: 2, maxPhotosPerProject: 15, video: false },
  GROWTH: { maxProjects: 6, maxPhotosPerProject: 40, video: true },
  PREMIER: { maxProjects: null, maxPhotosPerProject: 40, video: true },
};

// Until subscriptions exist (Phase 7), every builder gets the Growth limits so nobody is
// blocked while testing. Phase 7 replaces this with the plan the builder actually pays for.
export const PLAN_USED_UNTIL_BILLING: PlanCode = "GROWTH";

export function entitlementsFor(plan: PlanCode | null | undefined): Entitlements {
  return LIMITS[plan ?? PLAN_USED_UNTIL_BILLING];
}

export function entitlementsForBuilder(_builder: {
  interestedPlan: PlanCode | null;
}): Entitlements {
  // `interestedPlan` is only a stated interest, not a purchase, so it grants nothing yet.
  return entitlementsFor(PLAN_USED_UNTIL_BILLING);
}
