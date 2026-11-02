import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { istToday, parseDay } from "@/lib/featured/service";
import { PAGE_KINDS, SOURCES, type PageKind, type Source } from "@/lib/usage/site-kinds";

// Anonymous visit counters for the whole site. See SiteDailyStat in the schema: counters only, so
// nothing here identifies a person or a device. A "visit" is one browser session.

const DAY = 86_400_000;

/**
 * Adds one to the "visit" counter, the "page" counter, or both, in a single statement. One statement
 * is atomic, so a failure can never leave a session counted as having reached a page but not as a
 * visit (or the other way round), which two separate writes could.
 */
export async function recordSiteStats(
  db: PrismaClient,
  input: { visit: boolean; page: boolean; kind: PageKind; source: Source; now?: Date },
): Promise<void> {
  const events = [input.visit && "visit", input.page && "page"].filter(
    (event): event is "visit" | "page" => event !== false,
  );
  if (events.length === 0) return;
  const day = parseDay(istToday(input.now ?? new Date()))!;
  const rows = events.map(
    (event) => Prisma.sql`(${day}, ${event}, ${input.kind}, ${input.source}, 1)`,
  );
  await db.$executeRaw`
    INSERT INTO "SiteDailyStat" ("day", "event", "page", "source", "count")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("day", "event", "page", "source")
    DO UPDATE SET "count" = "SiteDailyStat"."count" + 1`;
}

export async function recordSiteStat(
  db: PrismaClient,
  input: { event: "visit" | "page"; page: PageKind; source: Source; now?: Date },
): Promise<void> {
  await recordSiteStats(db, {
    visit: input.event === "visit",
    page: input.event === "page",
    kind: input.page,
    source: input.source,
    now: input.now,
  });
}

export type SiteVisitSummary = {
  /** Browser sessions that reached the site (logged in or not), per period. */
  visits: { today: number; last7: number; last30: number };
  /** Last 30 days: where visits came from. */
  bySource: { source: Source; visits: number }[];
  /** Last 30 days: the page a visit started on. */
  entryPages: { page: PageKind; visits: number }[];
  /** Last 30 days: sessions that reached each kind of page (a session can reach several). */
  reached: { page: PageKind; sessions: number }[];
  daily: { day: string; visits: number }[];
};

export async function siteVisitSummary(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<SiteVisitSummary> {
  const to = parseDay(istToday(now))!;
  const from30 = new Date(to.getTime() - 29 * DAY);
  const from7 = new Date(to.getTime() - 6 * DAY);
  const rows = await db.siteDailyStat.findMany({
    where: { day: { gte: from30, lte: to } },
    select: { day: true, event: true, page: true, source: true, count: true },
  });

  const visits = { today: 0, last7: 0, last30: 0 };
  const bySource = new Map<string, number>();
  const entry = new Map<string, number>();
  const reached = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (let i = 0; i < 30; i++)
    byDay.set(new Date(from30.getTime() + i * DAY).toISOString().slice(0, 10), 0);

  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10);
    if (row.event === "visit") {
      visits.last30 += row.count;
      if (row.day >= from7) visits.last7 += row.count;
      if (row.day.getTime() === to.getTime()) visits.today += row.count;
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.count);
      entry.set(row.page, (entry.get(row.page) ?? 0) + row.count);
      byDay.set(key, (byDay.get(key) ?? 0) + row.count);
    } else if (row.event === "page") {
      reached.set(row.page, (reached.get(row.page) ?? 0) + row.count);
    }
  }
  return {
    visits,
    bySource: SOURCES.map((source) => ({ source, visits: bySource.get(source) ?? 0 })).filter(
      (s) => s.visits > 0,
    ),
    entryPages: PAGE_KINDS.map((page) => ({ page, visits: entry.get(page) ?? 0 })).filter(
      (p) => p.visits > 0,
    ),
    reached: PAGE_KINDS.map((page) => ({ page, sessions: reached.get(page) ?? 0 })).filter(
      (p) => p.sessions > 0,
    ),
    daily: [...byDay].map(([day, v]) => ({ day, visits: v })),
  };
}
