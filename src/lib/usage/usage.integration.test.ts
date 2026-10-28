import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { forgetRecordedActivity, recordActivity, usageSummary } from "@/lib/usage/activity";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe.skipIf(!url)("who uses the site (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    forgetRecordedActivity();
    await db.userActivity.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    for (const [key, role] of [
      ["buyer1", "BUYER"],
      ["buyer2", "BUYER"],
      ["owner", "BUILDER_OWNER"],
      ["team", "BUILDER_TEAM"],
      ["admin", "ADMIN"],
    ] as const) {
      ids[key] = (
        await db.user.create({
          data: { auth0Sub: `auth0|${key}`, email: `${key}@test.example`, role },
        })
      ).id;
    }
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const see = (who: string, mode: "buyer" | "builder" | "admin", now = NOW) =>
    recordActivity(db, { userId: ids[who], mode, now });

  it("records a person once a day per account, however often they are seen", async () => {
    await Promise.all([see("buyer1", "buyer"), see("buyer1", "buyer"), see("buyer1", "buyer")]);
    expect(await db.userActivity.count()).toBe(1);
    forgetRecordedActivity(); // another process, or a restart: the row is unique, so no duplicate
    await see("buyer1", "buyer");
    expect(await db.userActivity.count()).toBe(1);
    await see("buyer1", "buyer", new Date(NOW.getTime() + DAY));
    expect(await db.userActivity.count()).toBe(2);
  });

  it("keeps the two accounts of one person apart", async () => {
    await see("owner", "buyer");
    await see("owner", "builder");
    expect(await db.userActivity.count()).toBe(2);
  });

  it("never throws, even when the database refuses", async () => {
    await expect(
      recordActivity(db, { userId: "no-such-user", mode: "buyer", now: NOW }),
    ).resolves.toBeUndefined();
    expect(await db.userActivity.count()).toBe(0);
  });

  it("uses the Indian day", async () => {
    await see("buyer1", "buyer", new Date("2026-11-10T20:00:00Z")); // already 11 Nov in India
    expect((await db.userActivity.findFirstOrThrow()).day.toISOString().slice(0, 10)).toBe(
      "2026-11-11",
    );
  });

  describe("the summary", () => {
    it("counts the people with each kind of account", async () => {
      const s = await usageSummary(db, NOW);
      expect(s.registered).toEqual({ buyerAccounts: 4, builderAccounts: 2, staff: 1, total: 5 });
    });

    it("counts different people, per account, for today, seven days and thirty", async () => {
      await see("buyer1", "buyer");
      await see("buyer2", "buyer", daysAgo(3));
      await see("buyer2", "buyer", daysAgo(4)); // the same person on two days counts once
      await see("owner", "builder");
      await see("team", "builder", daysAgo(20));
      await see("buyer1", "buyer", daysAgo(40)); // outside 30 days
      const s = await usageSummary(db, NOW);
      expect(s.active.today).toEqual({ buyer: 1, builder: 1, admin: 0 });
      expect(s.active.last7).toEqual({ buyer: 2, builder: 1, admin: 0 });
      expect(s.active.last30).toEqual({ buyer: 2, builder: 2, admin: 0 });
    });

    it("counts someone who used both accounts, in both, and as one person who used both", async () => {
      await see("owner", "buyer");
      await see("owner", "builder", daysAgo(2));
      await see("team", "builder");
      const s = await usageSummary(db, NOW);
      expect(s.active.last30).toMatchObject({ buyer: 1, builder: 2 });
      expect(s.usedBoth30).toBe(1);
    });

    it("gives a day-by-day series with zeros for quiet days", async () => {
      await see("buyer1", "buyer");
      await see("buyer2", "buyer");
      await see("owner", "builder", daysAgo(1));
      const s = await usageSummary(db, NOW);
      expect(s.daily).toHaveLength(30);
      expect(s.daily.at(-1)).toEqual({ day: "2026-11-10", buyer: 2, builder: 0 });
      expect(s.daily.at(-2)).toEqual({ day: "2026-11-09", buyer: 0, builder: 1 });
      expect(s.daily[0].buyer + s.daily[0].builder).toBe(0);
    });

    it("is all zeros when nothing was recorded", async () => {
      const s = await usageSummary(db, NOW);
      expect(s.active.last30).toEqual({ buyer: 0, builder: 0, admin: 0 });
      expect(s.usedBoth30).toBe(0);
    });

    it("forgets a person's activity when their account is deleted", async () => {
      await see("buyer1", "buyer");
      await db.user.delete({ where: { id: ids.buyer1 } });
      expect(await db.userActivity.count()).toBe(0);
    });
  });
});
