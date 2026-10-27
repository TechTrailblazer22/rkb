import type { PrismaClient } from "@/generated/prisma/client";
import type { StatEvent } from "@/generated/prisma/enums";
import { istToday, parseDay } from "@/lib/featured/service";
import { csvCell } from "@/lib/leads/csv";

// Page analytics, kept as counters (see ProjectDailyStat): one row per project, day, event and
// traffic source, bumped by one atomic upsert. No visitor is identified and nothing personal is
// stored, so the free database stays small and there is nothing to anonymise later.

export const STAT_SOURCES = ["direct", "search", "home", "builder", "external"] as const;
export type StatSource = (typeof STAT_SOURCES)[number];
export const SOURCE_LABELS: Record<StatSource, string> = {
  direct: "Direct or shared link",
  search: "Search results",
  home: "Home page",
  builder: "Builder page",
  external: "Other websites",
};

/** The events a visitor's browser may report. The others are counted by the server itself. */
export const BROWSER_EVENTS = ["VIEW", "CALL", "WHATSAPP"] as const;
export type BrowserEvent = (typeof BROWSER_EVENTS)[number];

export const parseSource = (value: unknown): StatSource =>
  STAT_SOURCES.find((s) => s === value) ?? "direct";

export function parseBrowserEvent(value: unknown): BrowserEvent | null {
  return BROWSER_EVENTS.find((e) => e === value) ?? null;
}

/** Crawlers and scripted clients do not count as visitors. */
export function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl|wget|python|httpclient|go-http|axios|node-fetch|facebookexternalhit|whatsapp|telegram/i.test(
    userAgent,
  );
}

/** Adds one to a counter. Safe at any concurrency: the database does the arithmetic. */
export async function recordStat(
  db: PrismaClient,
  input: { projectId: string; event: StatEvent; source?: StatSource; now?: Date },
): Promise<void> {
  const day = parseDay(istToday(input.now ?? new Date()))!;
  const source = input.source ?? "direct";
  await db.$executeRaw`
    INSERT INTO "ProjectDailyStat" ("projectId", "day", "event", "source", "count")
    VALUES (${input.projectId}, ${day}, ${input.event}::"StatEvent", ${source}, 1)
    ON CONFLICT ("projectId", "day", "event", "source")
    DO UPDATE SET "count" = "ProjectDailyStat"."count" + 1`;
}

const DAY = 86_400_000;

export type EventTotals = Record<StatEvent, number>;
const emptyTotals = (): EventTotals => ({
  VIEW: 0,
  CALL: 0,
  WHATSAPP: 0,
  SHORTLIST: 0,
  ENQUIRY: 0,
  VISIT: 0,
});

export type BuilderStats = {
  from: Date;
  to: Date;
  days: number;
  totals: EventTotals;
  /** One entry per day, oldest first, with zeros for quiet days. */
  daily: { day: string; views: number; enquiries: number }[];
  perProject: { projectId: string; name: string; totals: EventTotals }[];
  sources: { source: StatSource; label: string; views: number }[];
  funnel: { views: number; enquiries: number; visits: number; booked: number };
};

/** The company's numbers for the last `days` days, ending today (Indian time). */
export async function statsForBuilder(
  db: PrismaClient,
  builderId: string,
  options: { days?: number; now?: Date; endDay?: Date } = {},
): Promise<BuilderStats> {
  const days = options.days ?? 30;
  const to = options.endDay ?? parseDay(istToday(options.now ?? new Date()))!;
  const from = new Date(to.getTime() - (days - 1) * DAY);

  const [rows, projects, booked] = await Promise.all([
    db.projectDailyStat.findMany({
      where: { project: { builderId }, day: { gte: from, lte: to } },
      select: { projectId: true, day: true, event: true, source: true, count: true },
    }),
    db.project.findMany({
      where: { builderId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.lead.count({
      where: { builderId, status: "BOOKED", updatedAt: { gte: from } },
    }),
  ]);

  const totals = emptyTotals();
  const byDay = new Map<string, { views: number; enquiries: number }>();
  for (let i = 0; i < days; i++) {
    byDay.set(new Date(from.getTime() + i * DAY).toISOString().slice(0, 10), {
      views: 0,
      enquiries: 0,
    });
  }
  const perProject = new Map(projects.map((p) => [p.id, { name: p.name, totals: emptyTotals() }]));
  const sourceViews = new Map<StatSource, number>();

  for (const row of rows) {
    totals[row.event] += row.count;
    const bucket = byDay.get(row.day.toISOString().slice(0, 10));
    if (bucket && row.event === "VIEW") bucket.views += row.count;
    if (bucket && row.event === "ENQUIRY") bucket.enquiries += row.count;
    const project = perProject.get(row.projectId);
    if (project) project.totals[row.event] += row.count;
    if (row.event === "VIEW") {
      const source = parseSource(row.source);
      sourceViews.set(source, (sourceViews.get(source) ?? 0) + row.count);
    }
  }

  return {
    from,
    to,
    days,
    totals,
    daily: [...byDay].map(([day, v]) => ({ day, ...v })),
    perProject: [...perProject].map(([projectId, v]) => ({ projectId, ...v })),
    sources: STAT_SOURCES.map((source) => ({
      source,
      label: SOURCE_LABELS[source],
      views: sourceViews.get(source) ?? 0,
    })).filter((s) => s.views > 0),
    funnel: {
      views: totals.VIEW,
      enquiries: totals.ENQUIRY,
      visits: totals.VISIT,
      booked,
    },
  };
}

/** The numbers as a CSV file: one row per project per day. */
export async function statsToCsv(
  db: PrismaClient,
  builderId: string,
  options: { days?: number; now?: Date } = {},
): Promise<string> {
  const days = options.days ?? 30;
  const to = parseDay(istToday(options.now ?? new Date()))!;
  const from = new Date(to.getTime() - (days - 1) * DAY);
  const rows = await db.projectDailyStat.findMany({
    where: { project: { builderId }, day: { gte: from, lte: to } },
    select: {
      day: true,
      event: true,
      source: true,
      count: true,
      project: { select: { name: true } },
    },
    orderBy: [{ day: "asc" }, { projectId: "asc" }],
  });
  const lines = [["Date", "Project", "Event", "Source", "Count"].join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.day.toISOString().slice(0, 10),
        row.project.name,
        row.event.toLowerCase(),
        row.source,
        row.count,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
