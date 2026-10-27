import type { BillingInterval, PlanCode } from "@/generated/prisma/enums";
import {
  addInterval,
  computeGst,
  planSubtotalPaise,
  prorationCreditPaise,
  type Gst,
} from "@/lib/billing/money";
import { isInForce } from "@/lib/entitlements";
import type { PlanChange } from "@/generated/prisma/enums";

// What a plan change costs and when it takes effect. Pure: the same inputs always give the same
// answer, so every rule below is covered by plain unit tests. See docs/BILLING.md.

export type CurrentPlan = {
  plan: PlanCode;
  interval: BillingInterval;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  /** What was paid for the running period, before GST. */
  paidSubtotalPaise: number;
  pendingPlan: PlanCode | null;
  pendingInterval: BillingInterval | null;
};

export type Target = { plan: PlanCode; interval: BillingInterval };

const RANK: Record<PlanCode, number> = { STARTER: 0, GROWTH: 1, PREMIER: 2 };
/** Paying further ahead than this is refused: a plan can be renewed early, but not stockpiled. */
const MAX_AHEAD_DAYS = 366;
const DAY = 86_400_000;

export type PayQuote = {
  kind: "pay";
  change: PlanChange;
  plan: PlanCode;
  interval: BillingInterval;
  /** The new period's list price, before credit and GST. */
  listPaise: number;
  /** The unused share of what was paid for the old period. */
  creditPaise: number;
  /** What is taxed: list price less credit. */
  subtotalPaise: number;
  gst: Gst;
  /** The new period, as it would be if the payment were settled now. */
  periodStart: Date;
  periodEnd: Date;
};

export type Quote =
  | PayQuote
  | {
      /** Takes effect at the end of the paid period, at the next renewal. Nothing to pay now. */
      kind: "schedule";
      plan: PlanCode;
      interval: BillingInterval;
      effectiveOn: Date;
    }
  | { kind: "none"; reason: string };

/** Whether switching to the target starts now (and is paid for now). */
function startsNow(current: CurrentPlan, target: Target): boolean {
  if (RANK[target.plan] > RANK[current.plan]) {
    // Monthly to annual is a bigger commitment; annual to monthly waits for the end of the year.
    return !(current.interval === "ANNUAL" && target.interval === "MONTHLY");
  }
  return (
    target.plan === current.plan && current.interval === "MONTHLY" && target.interval === "ANNUAL"
  );
}

export function quoteChange(input: {
  current: CurrentPlan | null;
  target: Target;
  now: Date;
  supplierState: string;
  customerState: string | null;
}): Quote {
  const { current, target, now } = input;
  const list = planSubtotalPaise(target.plan, target.interval);
  const price = (change: PlanChange, credit: number, start: Date, end: Date): PayQuote => {
    const subtotal = Math.max(0, list - credit);
    return {
      kind: "pay",
      change,
      plan: target.plan,
      interval: target.interval,
      listPaise: list,
      creditPaise: list - subtotal,
      subtotalPaise: subtotal,
      gst: computeGst({
        subtotalPaise: subtotal,
        supplierState: input.supplierState,
        customerState: input.customerState,
      }),
      periodStart: start,
      periodEnd: end,
    };
  };

  // No plan, or one that has ended: a fresh subscription from now.
  if (!current || !isInForce(current, now)) {
    return price("SUBSCRIBE", 0, now, addInterval(now, target.interval));
  }

  const running = current.currentPeriodEnd.getTime() > now.getTime();
  const sameAsCurrent = target.plan === current.plan && target.interval === current.interval;

  // The paid period is over and only the grace days are left: there is nothing to credit and
  // nothing to wait for, so anything chosen (including a change that was scheduled) starts now.
  if (!running) {
    return price(sameAsCurrent ? "RENEW" : "SUBSCRIBE", 0, now, addInterval(now, target.interval));
  }

  if (sameAsCurrent) {
    if (current.currentPeriodEnd.getTime() - now.getTime() > MAX_AHEAD_DAYS * DAY) {
      return { kind: "none", reason: "You are already paid up for more than a year ahead." };
    }
    // Renewing extends from the end of the paid period, so paying early loses no days.
    return price(
      "RENEW",
      0,
      current.currentPeriodStart,
      addInterval(current.currentPeriodEnd, target.interval),
    );
  }

  if (startsNow(current, target)) {
    const credit = prorationCreditPaise({
      paidSubtotalPaise: current.paidSubtotalPaise,
      periodStart: current.currentPeriodStart,
      periodEnd: current.currentPeriodEnd,
      now,
    });
    return price("UPGRADE", credit, now, addInterval(now, target.interval));
  }

  return {
    kind: "schedule",
    plan: target.plan,
    interval: target.interval,
    effectiveOn: current.currentPeriodEnd,
  };
}
