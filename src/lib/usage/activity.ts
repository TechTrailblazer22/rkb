import type { PrismaClient } from "@/generated/prisma/client";
import type { Mode } from "@/lib/auth/mode";
import { istToday, parseDay } from "@/lib/featured/service";

// Who uses the site, and through which account. A logged-in person is recorded once per day per
// account (buyer, builder or admin): one row, no page, no address, no device. Visitors who are not
// logged in are not counted here (the per-project view counts in the builder's analytics cover them).
//
// To keep the cost to almost nothing, each server process remembers who it already recorded today and
// writes only the first time; the database row is unique, so a second process or a restart that
// writes again does no harm.

const DAY = 86_400_000;
const MAX_REMEMBERED = 20_000;
let rememberedDay = "";
const remembered = new Set<string>();

/** Records that this person used the site through this account today. Never throws. */
export async function recordActivity(
  db: PrismaClient,
  input: { userId: string; mode: Mode; now?: Date },
): Promise<void> {
  const today = istToday(input.now ?? new Date());
  if (today !== rememberedDay) {
    remembered.clear();
    rememberedDay = today;
  }
  const key = `${input.mode}|${input.userId}`;
  if (remembered.has(key)) return;
  if (remembered.size >= MAX_REMEMBERED) remembered.clear();
  remembered.add(key);
  try {
    await db.$executeRaw`
      INSERT INTO "UserActivity" ("userId", "day", "mode")
      VALUES (${input.userId}, ${parseDay(today)!}, ${input.mode})
      ON CONFLICT DO NOTHING`;
  } catch (error) {
    // Counting must never break a page. Forget it, so the next visit tries again.
    remembered.delete(key);
    console.error("Could not record account activity", error);
  }
}

/** For tests: forget what this process has already written. */
export function forgetRecordedActivity() {
  remembered.clear();
  rememberedDay = "";
}

export type ModeCounts = { buyer: number; builder: number; admin: number };

export type UsageSummary = {
  /** People with an account: everyone but staff has a buyer account; builders also have a builder one. */
  registered: { buyerAccounts: number; builderAccounts: number; staff: number; total: number };
  /** Different people who used each account in the period (a person using both counts in both). */
  active: { today: ModeCounts; last7: ModeCounts; last30: ModeCounts };
  /** People who used both a buyer and a builder account within 30 days. */
  usedBoth30: number;
  /** One entry per day for the last 30 days, oldest first. */
  daily: { day: string; buyer: number; builder: number }[];
};

const empty = (): ModeCounts => ({ buyer: 0, builder: 0, admin: 0 });

export async function usageSummary(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const to = parseDay(istToday(now))!;
  const from30 = new Date(to.getTime() - 29 * DAY);
  const from7 = new Date(to.getTime() - 6 * DAY);

  const [roles, distinct, daily, both] = await Promise.all([
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    db.$queryRaw<{ win: string; mode: string; n: number }[]>`
      SELECT w.win, a."mode", COUNT(DISTINCT a."userId")::int AS n
      FROM "UserActivity" a
      JOIN (VALUES ('today', ${to}::date), ('last7', ${from7}::date), ('last30', ${from30}::date))
        AS w(win, since) ON a."day" >= w.since AND a."day" <= ${to}::date
      GROUP BY w.win, a."mode"`,
    db.$queryRaw<{ day: Date; mode: string; n: number }[]>`
      SELECT "day", "mode", COUNT(*)::int AS n
      FROM "UserActivity"
      WHERE "day" >= ${from30}::date AND "day" <= ${to}::date
      GROUP BY "day", "mode"`,
    db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT "userId" FROM "UserActivity"
        WHERE "day" >= ${from30}::date AND "day" <= ${to}::date AND "mode" IN ('buyer', 'builder')
        GROUP BY "userId" HAVING COUNT(DISTINCT "mode") = 2
      ) both_modes`,
  ]);

  const count = (role: string) => roles.find((r) => r.role === role)?._count._all ?? 0;
  const builderAccounts = count("BUILDER_OWNER") + count("BUILDER_TEAM");
  const staff = count("ADMIN");
  const total = roles.reduce((n, r) => n + r._count._all, 0);

  const active = { today: empty(), last7: empty(), last30: empty() };
  for (const row of distinct) {
    if (row.win in active && row.mode in active.today) {
      active[row.win as keyof typeof active][row.mode as keyof ModeCounts] = row.n;
    }
  }

  const byDay = new Map<string, { buyer: number; builder: number }>();
  for (let i = 0; i < 30; i++) {
    byDay.set(new Date(from30.getTime() + i * DAY).toISOString().slice(0, 10), {
      buyer: 0,
      builder: 0,
    });
  }
  for (const row of daily) {
    const bucket = byDay.get(row.day.toISOString().slice(0, 10));
    if (bucket && (row.mode === "buyer" || row.mode === "builder")) bucket[row.mode] = row.n;
  }

  return {
    // Everyone except staff has a buyer account.
    registered: { buyerAccounts: total - staff, builderAccounts, staff, total },
    active,
    usedBoth30: both[0]?.n ?? 0,
    daily: [...byDay].map(([day, v]) => ({ day, ...v })),
  };
}
