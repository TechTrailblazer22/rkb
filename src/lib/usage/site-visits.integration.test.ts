import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { classifyPath, classifyReferrer } from "@/lib/usage/site-kinds";
import { recordSiteStat, recordSiteStats, siteVisitSummary } from "@/lib/usage/site-visits";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("classifyPath", () => {
  it("sorts addresses into the kinds the counters know", () => {
    expect(classifyPath("/")).toBe("home");
    expect(classifyPath("/projects")).toBe("search");
    expect(classifyPath("/projects/coimbatore/plots")).toBe("search");
    expect(classifyPath("/project/green-valley")).toBe("project");
    expect(classifyPath("/builder/anand")).toBe("builder");
    expect(classifyPath("/pricing")).toBe("marketing");
    expect(classifyPath("/for-builders")).toBe("marketing");
    expect(classifyPath("/login")).toBe("login");
    expect(classifyPath("/account/enquiries")).toBe("account");
    expect(classifyPath("/portal/leads")).toBe("account");
    expect(classifyPath("/project/x?enquire=1#plots")).toBe("project");
  });
  it("never counts the admin console, the API or plumbing pages", () => {
    for (const path of [
      "/admin",
      "/admin/usage",
      "/api/health",
      "/auth/login",
      "/switch",
      "/welcome",
      "/logout",
      "/nope",
    ]) {
      expect(classifyPath(path), path).toBeNull();
    }
  });
});

describe("classifyReferrer", () => {
  const own = "rkb.example";
  it("keeps one word and nothing else", () => {
    expect(classifyReferrer("", own)).toBe("direct");
    expect(classifyReferrer("not a url", own)).toBe("direct");
    expect(classifyReferrer("https://rkb.example/projects?q=x", own)).toBe("direct");
    expect(classifyReferrer("https://www.google.com/search?q=plots+in+hosur", own)).toBe(
      "search_engine",
    );
    expect(classifyReferrer("https://www.bing.com/", own)).toBe("search_engine");
    expect(classifyReferrer("https://duckduckgo.com/", own)).toBe("search_engine");
    expect(classifyReferrer("https://l.facebook.com/l.php?u=x", own)).toBe("social");
    expect(classifyReferrer("https://t.co/abc", own)).toBe("social");
    expect(classifyReferrer("https://www.instagram.com/", own)).toBe("social");
    expect(classifyReferrer("https://some-blog.example/post", own)).toBe("other");
  });
  it("is not fooled by a look-alike host", () => {
    expect(classifyReferrer("https://notgoogle.com.evil.example/", own)).toBe("other");
    expect(classifyReferrer("https://google.evil.example/", own)).toBe("other");
  });
});

describe.skipIf(!url)("site visit counters (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  beforeEach(async () => {
    await db.siteDailyStat.deleteMany();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const visit = (
    page: "home" | "search" | "project",
    source: "direct" | "search_engine" | "social" | "other",
    now = NOW,
  ) => recordSiteStat(db, { event: "visit", page, source, now });
  const reach = (page: "home" | "search" | "project", now = NOW) =>
    recordSiteStat(db, { event: "page", page, source: "direct", now });

  it("adds up exactly even when hundreds arrive at once", async () => {
    await Promise.all(Array.from({ length: 80 }, () => visit("home", "direct")));
    expect((await siteVisitSummary(db, NOW)).visits.today).toBe(80);
    expect(await db.siteDailyStat.count()).toBe(1);
  });

  it("counts a session's first page as a visit and a reached page, together", async () => {
    await recordSiteStats(db, {
      visit: true,
      page: true,
      kind: "project",
      source: "social",
      now: NOW,
    });
    const rows = await db.siteDailyStat.findMany({ orderBy: { event: "asc" } });
    expect(rows.map((r) => [r.event, r.page, r.source, r.count])).toEqual([
      ["page", "project", "social", 1],
      ["visit", "project", "social", 1],
    ]);
  });

  it("counts only a reached page when the session was already counted", async () => {
    await recordSiteStats(db, {
      visit: false,
      page: true,
      kind: "search",
      source: "direct",
      now: NOW,
    });
    const rows = await db.siteDailyStat.findMany();
    expect(rows.map((r) => r.event)).toEqual(["page"]);
  });

  it("writes nothing when neither is asked for", async () => {
    await recordSiteStats(db, {
      visit: false,
      page: false,
      kind: "home",
      source: "direct",
      now: NOW,
    });
    expect(await db.siteDailyStat.count()).toBe(0);
  });

  it("adds up both counters exactly under concurrency", async () => {
    await Promise.all(
      Array.from({ length: 40 }, () =>
        recordSiteStats(db, { visit: true, page: true, kind: "home", source: "direct", now: NOW }),
      ),
    );
    const rows = await db.siteDailyStat.findMany({ orderBy: { event: "asc" } });
    expect(rows.map((r) => [r.event, r.count])).toEqual([
      ["page", 40],
      ["visit", 40],
    ]);
  });

  it("stores only counters: no field that could identify anyone", async () => {
    await visit("home", "social");
    const row = await db.siteDailyStat.findFirstOrThrow();
    expect(Object.keys(row).sort()).toEqual(["count", "day", "event", "page", "source"]);
  });

  it("totals visits for today, seven days and thirty, by source and entry page", async () => {
    await visit("home", "direct");
    await visit("home", "search_engine");
    await visit("project", "search_engine", daysAgo(3));
    await visit("search", "social", daysAgo(20));
    await visit("home", "direct", daysAgo(40)); // outside the window
    const s = await siteVisitSummary(db, NOW);
    expect(s.visits).toEqual({ today: 2, last7: 3, last30: 4 });
    expect(s.bySource).toEqual([
      { source: "direct", visits: 1 },
      { source: "search_engine", visits: 2 },
      { source: "social", visits: 1 },
    ]);
    expect(s.entryPages).toEqual([
      { page: "home", visits: 2 },
      { page: "search", visits: 1 },
      { page: "project", visits: 1 },
    ]);
  });

  it("counts which kinds of page sessions reached, separately from visits", async () => {
    await visit("home", "direct");
    await reach("home");
    await reach("search");
    await reach("project");
    await reach("project");
    const s = await siteVisitSummary(db, NOW);
    expect(s.visits.today).toBe(1);
    expect(s.reached).toEqual([
      { page: "home", sessions: 1 },
      { page: "search", sessions: 1 },
      { page: "project", sessions: 2 },
    ]);
  });

  it("gives a 30 day series with zeros, by Indian day", async () => {
    await visit("home", "direct", new Date("2026-11-10T20:00:00Z")); // 11 Nov in India
    await visit("home", "direct", NOW); // 10 Nov in India
    const s = await siteVisitSummary(db, new Date("2026-11-11T08:00:00Z"));
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)).toEqual({ day: "2026-11-11", visits: 1 });
    expect(s.daily.at(-2)).toEqual({ day: "2026-11-10", visits: 1 });
    expect(s.daily[0].visits).toBe(0);
  });

  it("is all zeros when nothing has been counted", async () => {
    const s = await siteVisitSummary(db, NOW);
    expect(s.visits).toEqual({ today: 0, last7: 0, last30: 0 });
    expect(s.bySource).toEqual([]);
  });
});
