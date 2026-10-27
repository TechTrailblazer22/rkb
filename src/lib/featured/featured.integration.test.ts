import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  dayString,
  featuredInMonth,
  istToday,
  parseDay,
  removeFeaturedDay,
  scheduleFeaturedDay,
  upcomingFeatured,
} from "@/lib/featured/service";
import { EMPTY_FILTERS } from "@/lib/search/params";
import { searchRows } from "@/lib/search/query";

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

describe("istToday and parseDay", () => {
  it("uses the Indian calendar day", () => {
    // 20:00 UTC is already the next morning in India
    expect(istToday(new Date("2026-11-10T20:00:00Z"))).toBe("2026-11-11");
    expect(istToday(new Date("2026-11-10T10:00:00Z"))).toBe("2026-11-10");
  });
  it("accepts only real dates", () => {
    expect(parseDay("2026-11-10")?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    for (const bad of ["2026-02-30", "2026-13-01", "10-11-2026", "", "2026-1-1", "x"]) {
      expect(parseDay(bad)).toBeNull();
    }
  });
});

describe.skipIf(!url)("featured days and paid placement (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const now = new Date();
  const today = istToday(now);
  const inDays = (n: number) => dayString(new Date(parseDay(today)!.getTime() + n * DAY));
  let counter = 0;

  const newBuilder = (name: string) =>
    db.builder.create({
      data: {
        companyName: name,
        status: "VERIFIED",
        slug: name.toLowerCase().replace(/\W+/g, "-"),
      },
    });
  const planFor = (builderId: string, plan: "STARTER" | "GROWTH" | "PREMIER", endsInDays = 20) =>
    db.subscription.upsert({
      where: { builderId },
      create: {
        builderId,
        plan,
        interval: "MONTHLY",
        source: "COMP",
        currentPeriodStart: new Date(now.getTime() - 5 * DAY),
        currentPeriodEnd: new Date(now.getTime() + endsInDays * DAY),
      },
      update: { plan, currentPeriodEnd: new Date(now.getTime() + endsInDays * DAY) },
    });
  const project = (builderId: string, name: string, publishedDaysAgo: number, status = "LIVE") => {
    counter++;
    return db.project.create({
      data: {
        builderId,
        name,
        slug: `p-${counter}`,
        type: "PLOTTED",
        status: status as "LIVE",
        city: "Coimbatore",
        publishedAt: new Date(now.getTime() - publishedDaysAgo * DAY),
      },
    });
  };
  const names = async (options: Parameters<typeof searchRows>[2] = {}) =>
    (await searchRows(db, EMPTY_FILTERS, options)).rows.map((r) => r.name);

  let growth: string;
  beforeEach(async () => {
    counter = 0;
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    growth = (await newBuilder("Growth Homes")).id;
    await planFor(growth, "GROWTH");
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const schedule = (projectId: string, day: string, over: Record<string, unknown> = {}) =>
    scheduleFeaturedDay(db, {
      builderId: growth,
      projectId,
      day,
      allowancePerMonth: 2,
      actorId: "a",
      now,
      ...over,
    });

  describe("scheduling", () => {
    it("books a day for a live project and lists it", async () => {
      const p = await project(growth, "Green Valley", 3);
      expect(await schedule(p.id, inDays(1))).toEqual({ ok: true });
      const upcoming = await upcomingFeatured(db, growth, now);
      expect(upcoming.map((u) => [u.projectName, dayString(u.day)])).toEqual([
        ["Green Valley", inDays(1)],
      ]);
    });

    it("refuses a bad date, a past day, a day too far ahead, and a plan with no allowance", async () => {
      const p = await project(growth, "Green Valley", 3);
      expect(await schedule(p.id, "nonsense")).toMatchObject({ ok: false, code: "bad_day" });
      expect(await schedule(p.id, inDays(-1))).toMatchObject({ ok: false, code: "past" });
      expect(await schedule(p.id, inDays(61))).toMatchObject({ ok: false, code: "too_far" });
      expect(await schedule(p.id, inDays(1), { allowancePerMonth: 0 })).toMatchObject({
        ok: false,
        code: "no_allowance",
      });
    });

    it("books today", async () => {
      const p = await project(growth, "Green Valley", 3);
      expect(await schedule(p.id, today)).toEqual({ ok: true });
    });

    it("features only live projects of the company itself", async () => {
      const draft = await project(growth, "Draft", 3, "DRAFT");
      expect(await schedule(draft.id, inDays(1))).toMatchObject({ ok: false, code: "not_live" });
      const other = await newBuilder("Other");
      const theirs = await project(other.id, "Theirs", 3);
      expect(await schedule(theirs.id, inDays(1))).toMatchObject({ ok: false, code: "not_live" });
      expect(await db.featuredDay.count()).toBe(0);
    });

    it("stops at the monthly allowance, counted by the month of the featured day", async () => {
      const p = await project(growth, "Green Valley", 3);
      const q = await project(growth, "Lake View", 4);
      expect(await schedule(p.id, inDays(1))).toEqual({ ok: true });
      expect(await schedule(q.id, inDays(1))).toEqual({ ok: true });
      expect(await schedule(p.id, inDays(2))).toMatchObject({ ok: false, code: "used_up" });
      expect(await featuredInMonth(db, growth, parseDay(inDays(1))!)).toBe(2);
    });

    it("refuses the same project and day twice", async () => {
      const p = await project(growth, "Green Valley", 3);
      await schedule(p.id, inDays(1));
      expect(await schedule(p.id, inDays(1))).toMatchObject({ ok: false, code: "already" });
    });

    it("never goes over the allowance when bookings arrive at once", async () => {
      const ps = await Promise.all(["a", "b", "c", "d"].map((n, i) => project(growth, n, i + 1)));
      const results = await Promise.all(ps.map((p) => schedule(p.id, inDays(1))));
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(await db.featuredDay.count()).toBe(2);
    });

    it("gives the day back when it is taken back before it starts, but not today's", async () => {
      const p = await project(growth, "Green Valley", 3);
      await schedule(p.id, today);
      await schedule(p.id, inDays(1));
      const remove = (day: string) =>
        removeFeaturedDay(db, { builderId: growth, projectId: p.id, day, actorId: "a", now });
      expect(await remove(today)).toBe(false);
      expect(await remove(inDays(1))).toBe(true);
      expect(await remove(inDays(1))).toBe(false);
      expect(await db.featuredDay.count()).toBe(1);
    });

    it("cannot take back another company's day", async () => {
      const p = await project(growth, "Green Valley", 3);
      await schedule(p.id, inDays(1));
      const other = await newBuilder("Other");
      expect(
        await removeFeaturedDay(db, {
          builderId: other.id,
          projectId: p.id,
          day: inDays(1),
          actorId: "a",
          now,
        }),
      ).toBe(false);
    });
  });

  describe("ranking", () => {
    it("lists newest first when nobody has paid for placement", async () => {
      await project(growth, "Old", 30);
      await project(growth, "New", 1);
      await project(growth, "Middle", 10);
      expect(await names()).toEqual(["New", "Middle", "Old"]);
    });

    it("puts a project featured today first, and only today", async () => {
      await project(growth, "Old", 30);
      const mid = await project(growth, "Middle", 10);
      await project(growth, "New", 1);
      await db.featuredDay.create({
        data: { projectId: mid.id, builderId: growth, day: parseDay(inDays(1))! },
      });
      expect(await names()).toEqual(["New", "Middle", "Old"]);
      await db.featuredDay.create({
        data: { projectId: mid.id, builderId: growth, day: parseDay(today)! },
      });
      const { rows } = await searchRows(db, EMPTY_FILTERS);
      expect(rows.map((r) => [r.name, r.promoted])).toEqual([
        ["Middle", true],
        ["New", false],
        ["Old", false],
      ]);
    });

    it("lists a Premier company's projects first, then featured-today, then the rest", async () => {
      const premier = (await newBuilder("Premier Estates")).id;
      await planFor(premier, "PREMIER");
      await project(premier, "Premier Old", 40);
      const featured = await project(growth, "Featured", 20);
      await project(growth, "Plain New", 1);
      await db.featuredDay.create({
        data: { projectId: featured.id, builderId: growth, day: parseDay(today)! },
      });
      expect(await names()).toEqual(["Featured", "Premier Old", "Plain New"]);
    });

    it("stops ranking a Premier company once its plan has ended past the grace days", async () => {
      const premier = (await newBuilder("Premier Estates")).id;
      await planFor(premier, "PREMIER", -4);
      await project(premier, "Premier Old", 40);
      await project(growth, "Plain New", 1);
      expect(await names()).toEqual(["Plain New", "Premier Old"]);
      await planFor(premier, "PREMIER", -2); // still inside the grace days
      expect(await names()).toEqual(["Premier Old", "Plain New"]);
    });

    it("leaves explicit sorts alone, and plainNewest ignores placement", async () => {
      const premier = (await newBuilder("Premier Estates")).id;
      await planFor(premier, "PREMIER");
      await project(premier, "Premier Old", 40);
      await project(growth, "Plain New", 1);
      expect(await names({ plainNewest: true })).toEqual(["Plain New", "Premier Old"]);
      const byAvailable = await searchRows(db, { ...EMPTY_FILTERS, sort: "price_asc" });
      expect(byAvailable.rows).toHaveLength(2);
    });
  });

  describe("homepage spotlight", () => {
    it("shows only Premier companies in force, live and verified", async () => {
      const premier = (await newBuilder("Premier Estates")).id;
      await planFor(premier, "PREMIER");
      await project(premier, "Spot One", 5);
      await project(premier, "Spot Paused", 5, "PAUSED");
      await project(growth, "Growth Project", 1);
      expect(await names({ spotlight: true })).toEqual(["Spot One"]);

      await planFor(premier, "PREMIER", -4);
      expect(await names({ spotlight: true })).toEqual([]);
    });

    it("drops a suspended company", async () => {
      const premier = (await newBuilder("Premier Estates")).id;
      await planFor(premier, "PREMIER");
      await project(premier, "Spot One", 5);
      await db.builder.update({ where: { id: premier }, data: { status: "SUSPENDED" } });
      expect(await names({ spotlight: true })).toEqual([]);
    });
  });
});
