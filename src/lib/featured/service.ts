import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";

// Featured days: a company on a plan with an allowance (Growth: 2 a month) picks the days on which
// a live project is featured at the top of search. Days are Indian calendar days, stored as dates.
// The allowance counts the days in the calendar month the featured day falls in. A day can be taken
// back only before it begins, and then it counts as unused.

export const BOOKING_WINDOW_DAYS = 60;
const DAY = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in India, as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return dayFormat.format(now);
}

/** A YYYY-MM-DD string as a date at midnight UTC (how a Postgres date comes back), or null. */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const dayString = (date: Date) => date.toISOString().slice(0, 10);

function monthRange(day: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
  return { from, to };
}

/** How many featured days a company has set in the month that contains `day`. */
export async function featuredInMonth(
  db: PrismaClient,
  builderId: string,
  day: Date,
): Promise<number> {
  const { from, to } = monthRange(day);
  return db.featuredDay.count({ where: { builderId, day: { gte: from, lt: to } } });
}

export type FeaturedEntry = { projectId: string; projectName: string; day: Date };

/** Today's and coming featured days, soonest first. */
export async function upcomingFeatured(
  db: PrismaClient,
  builderId: string,
  now: Date = new Date(),
): Promise<FeaturedEntry[]> {
  const today = parseDay(istToday(now))!;
  const rows = await db.featuredDay.findMany({
    where: { builderId, day: { gte: today } },
    orderBy: [{ day: "asc" }, { projectId: "asc" }],
    select: { projectId: true, day: true, project: { select: { name: true } } },
  });
  return rows.map((r) => ({ projectId: r.projectId, projectName: r.project.name, day: r.day }));
}

export type ScheduleResult =
  | { ok: true }
  | {
      ok: false;
      code: "bad_day" | "past" | "too_far" | "not_live" | "no_allowance" | "used_up" | "already";
      message: string;
    };

export async function scheduleFeaturedDay(
  db: PrismaClient,
  input: {
    builderId: string;
    projectId: string;
    day: string;
    /** From the plan: featured days per month. 0 means the plan has none. */
    allowancePerMonth: number;
    actorId: string;
    now?: Date;
  },
): Promise<ScheduleResult> {
  const now = input.now ?? new Date();
  const day = parseDay(input.day);
  if (!day) return { ok: false, code: "bad_day", message: "Choose a valid date." };
  const today = parseDay(istToday(now))!;
  if (day.getTime() < today.getTime()) {
    return { ok: false, code: "past", message: "That day has already passed." };
  }
  if (day.getTime() > today.getTime() + BOOKING_WINDOW_DAYS * DAY) {
    return {
      ok: false,
      code: "too_far",
      message: `You can feature a project up to ${BOOKING_WINDOW_DAYS} days ahead.`,
    };
  }
  if (input.allowancePerMonth <= 0) {
    return {
      ok: false,
      code: "no_allowance",
      message: "Your plan does not include featured days.",
    };
  }

  return db.$transaction(async (tx): Promise<ScheduleResult> => {
    // One company's bookings are taken one at a time, so the monthly allowance cannot be overshot.
    await tx.$queryRaw`SELECT "id" FROM "Builder" WHERE "id" = ${input.builderId} FOR UPDATE`;
    const project = await tx.project.findFirst({
      where: { id: input.projectId, builderId: input.builderId, status: "LIVE" },
      select: { id: true },
    });
    if (!project) {
      return {
        ok: false,
        code: "not_live",
        message: "Only a live project of yours can be featured.",
      };
    }
    const exists = await tx.featuredDay.findUnique({
      where: { projectId_day: { projectId: project.id, day } },
      select: { projectId: true },
    });
    if (exists) {
      return { ok: false, code: "already", message: "That project is already featured that day." };
    }
    const { from, to } = monthRange(day);
    const used = await tx.featuredDay.count({
      where: { builderId: input.builderId, day: { gte: from, lt: to } },
    });
    if (used >= input.allowancePerMonth) {
      return {
        ok: false,
        code: "used_up",
        message: `You have used all ${input.allowancePerMonth} featured days for that month.`,
      };
    }
    await tx.featuredDay.create({
      data: { projectId: project.id, builderId: input.builderId, day },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "featured.scheduled",
      entity: "Project",
      entityId: project.id,
      meta: { day: input.day },
    });
    return { ok: true };
  });
}

/** Takes back a featured day that has not started yet. Today's and past days stay. */
export async function removeFeaturedDay(
  db: PrismaClient,
  input: {
    builderId: string;
    projectId: string;
    day: string;
    actorId: string;
    now?: Date;
  },
): Promise<boolean> {
  const day = parseDay(input.day);
  const today = parseDay(istToday(input.now ?? new Date()))!;
  if (!day || day.getTime() <= today.getTime()) return false;
  const removed = await db.featuredDay.deleteMany({
    where: { projectId: input.projectId, builderId: input.builderId, day },
  });
  if (removed.count !== 1) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "featured.removed",
    entity: "Project",
    entityId: input.projectId,
    meta: { day: input.day },
  });
  return true;
}
