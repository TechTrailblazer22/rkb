import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { setShortlisted, listShortlistIds } from "@/lib/shortlist/service";
import { listingsByIds } from "@/lib/search/cards";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("public pages and shortlist (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let publicLib: typeof import("@/lib/search/public");
  let builderId: string;
  let userId: string;
  let n = 0;

  beforeAll(async () => {
    // getDb() reads the database address from the environment, so point it at the test database.
    vi.stubEnv("DATABASE_URL", url!);
    publicLib = await import("@/lib/search/public");
  });

  beforeEach(async () => {
    await db.shortlist.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    n = 0;
    builderId = (await newBuilder("Anand Realty")).id;
    userId = (await db.user.create({ data: { auth0Sub: "auth0|u", email: "u@example.com" } })).id;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  async function newBuilder(name: string, status: "VERIFIED" | "SUSPENDED" | "DRAFT" = "VERIFIED") {
    return db.builder.create({
      data: {
        companyName: name,
        status,
        slug: name.toLowerCase().replace(/\W+/g, "-"),
        about: "About us",
        pan: "ABCDE1234F",
        gstin: "27AAPFU0939F1ZV",
        contactMobile: "9876543210",
        addressLine: "12 Private Street",
        city: "Coimbatore",
        state: "Tamil Nadu",
        yearEstablished: 2010,
        serviceCities: ["Coimbatore"],
        verifiedAt: new Date(),
      },
    });
  }

  async function project(
    name: string,
    options: {
      status?: "LIVE" | "DRAFT" | "PAUSED";
      slug?: string | null;
      city?: string;
      type?: "PLOTTED" | "RESIDENTIAL";
      builder?: string;
      plots?: number;
    } = {},
  ) {
    n++;
    return db.project.create({
      data: {
        builderId: options.builder ?? builderId,
        name,
        status: options.status ?? "LIVE",
        slug: options.slug === undefined ? `proj-${n}` : options.slug,
        city: options.city ?? "Coimbatore",
        locality: "Sulur",
        type: options.type ?? "PLOTTED",
        publishedAt: new Date(),
        plots: {
          create: Array.from({ length: options.plots ?? 2 }, (_, i) => ({
            number: `P-${i + 1}`,
            sortKey: `p-${String(i + 1).padStart(8, "0")}`,
            sizeSqft: 1000 + i,
            price: 1_000_000 + i,
          })),
        },
      },
    });
  }

  describe("loadPublicProject", () => {
    it("returns a live project of a verified builder, by its address", async () => {
      await project("Green Valley", { slug: "green-valley" });
      const page = await publicLib.loadPublicProject("green-valley");
      expect(page?.project.name).toBe("Green Valley");
      expect(page?.plots).toHaveLength(2);
      expect(page?.builder).toMatchObject({
        companyName: "Anand Realty",
        slug: "anand-realty",
        verified: true,
      });
    });

    it("never returns a different project when the one asked for is not public", async () => {
      await project("Live one", { slug: "live-one" });
      await project("Draft one", { slug: "draft-one", status: "DRAFT" });
      await project("Paused one", { slug: "paused-one", status: "PAUSED" });
      expect(await publicLib.loadPublicProject("draft-one")).toBeNull();
      expect(await publicLib.loadPublicProject("paused-one")).toBeNull();
      expect(await publicLib.loadPublicProject("does-not-exist")).toBeNull();
      expect((await publicLib.loadPublicProject("live-one"))?.project.name).toBe("Live one");
    });

    it("hides every project of a builder who is suspended", async () => {
      await project("Hidden soon", { slug: "hidden-soon" });
      expect(await publicLib.loadPublicProject("hidden-soon")).not.toBeNull();
      await db.builder.update({ where: { id: builderId }, data: { status: "SUSPENDED" } });
      expect(await publicLib.loadPublicProject("hidden-soon")).toBeNull();
    });

    it("suggests similar projects in the same city and type, but not itself or other kinds", async () => {
      await project("Main", { slug: "main" });
      await project("Twin A", { slug: "twin-a" });
      await project("Twin B", { slug: "twin-b" });
      await project("Other city", { slug: "other-city", city: "Chennai" });
      await project("Flats", { slug: "flats", type: "RESIDENTIAL" });
      await project("Paused twin", { slug: "paused-twin", status: "PAUSED" });
      const names = (await publicLib.loadPublicProject("main"))?.similar.map((c) => c.name).sort();
      expect(names).toEqual(["Twin A", "Twin B"]);
    });

    it("sends the browser at most 300 plots", async () => {
      await project("Big", { slug: "big", plots: 320 });
      const page = await publicLib.loadPublicProject("big");
      expect(page?.plots).toHaveLength(300);
      expect(page?.plotCounts.total).toBe(320);
    });
  });

  describe("loadPublicBuilder", () => {
    it("shows the public profile and nothing private", async () => {
      const profile = await publicLib.loadPublicBuilder("anand-realty");
      expect(profile).toMatchObject({
        companyName: "Anand Realty",
        about: "About us",
        city: "Coimbatore",
        yearEstablished: 2010,
      });
      const text = JSON.stringify(profile);
      for (const secret of ["ABCDE1234F", "27AAPFU0939F1ZV", "9876543210", "12 Private Street"]) {
        expect(text).not.toContain(secret);
      }
      for (const key of [
        "pan",
        "gstin",
        "contactMobile",
        "addressLine",
        "reviewNote",
        "reviewedById",
      ]) {
        expect(Object.keys(profile ?? {})).not.toContain(key);
      }
    });

    it("is not available for a builder who is not verified", async () => {
      await newBuilder("Suspended Co", "SUSPENDED");
      await newBuilder("Draft Co", "DRAFT");
      expect(await publicLib.loadPublicBuilder("suspended-co")).toBeNull();
      expect(await publicLib.loadPublicBuilder("draft-co")).toBeNull();
      expect(await publicLib.loadPublicBuilder("nobody")).toBeNull();
    });
  });

  describe("cities and the sitemap", () => {
    it("merges spellings of one city, counts public projects only, and orders by how many", async () => {
      await project("A", { city: "Coimbatore" });
      await project("B", { city: "coimbatore" });
      await project("C", { city: "Chennai" });
      await project("Hidden", { city: "Madurai", status: "DRAFT" });
      const cities = await publicLib.listCities(db);
      expect(cities).toEqual([
        { name: expect.stringMatching(/^[Cc]oimbatore$/), slug: "coimbatore", count: 2 },
        { name: "Chennai", slug: "chennai", count: 1 },
      ]);
    });

    it("turns a city address back into a name, only for cities with projects", async () => {
      await project("A", { city: "Coimbatore" });
      expect((await publicLib.cityFromSlug("coimbatore"))?.slug).toBe("coimbatore");
      expect((await publicLib.cityFromSlug("COIMBATORE"))?.slug).toBe("coimbatore");
      expect(await publicLib.cityFromSlug("atlantis")).toBeNull();
    });

    it("lists public projects, builders, cities and city and type pages for the sitemap", async () => {
      await project("A", { slug: "a", city: "Coimbatore", type: "PLOTTED" });
      await project("B", { slug: "b", city: "Coimbatore", type: "RESIDENTIAL" });
      await project("Draft", { slug: "d", status: "DRAFT" });
      const entries = await publicLib.listSitemapEntries(db);
      expect(entries.projects.map((p) => p.slug).sort()).toEqual(["a", "b"]);
      expect(entries.builders.map((b) => b.slug)).toEqual(["anand-realty"]);
      expect(entries.combos).toHaveLength(2);
    });
  });

  describe("shortlist", () => {
    it("saves, lists newest first, and removes", async () => {
      const a = await project("A");
      const b = await project("B");
      expect(await setShortlisted(db, { userId, projectId: a.id, saved: true })).toEqual({
        ok: true,
        saved: true,
      });
      await new Promise((r) => setTimeout(r, 15));
      await setShortlisted(db, { userId, projectId: b.id, saved: true });
      expect(await listShortlistIds(db, userId)).toEqual([b.id, a.id]);
      expect(await setShortlisted(db, { userId, projectId: a.id, saved: false })).toEqual({
        ok: true,
        saved: false,
      });
      expect(await listShortlistIds(db, userId)).toEqual([b.id]);
    });

    it("is harmless to save twice or to remove something never saved", async () => {
      const a = await project("A");
      await setShortlisted(db, { userId, projectId: a.id, saved: true });
      await setShortlisted(db, { userId, projectId: a.id, saved: true });
      expect(await db.shortlist.count()).toBe(1);
      expect(await setShortlisted(db, { userId, projectId: "never-saved", saved: false })).toEqual({
        ok: true,
        saved: false,
      });
    });

    it("will not save a project that is not public", async () => {
      const draft = await project("Draft", { status: "DRAFT" });
      const suspended = await newBuilder("Suspended Co", "SUSPENDED");
      const hidden = await project("Hidden", { builder: suspended.id });
      for (const id of [draft.id, hidden.id, "missing"]) {
        expect(await setShortlisted(db, { userId, projectId: id, saved: true })).toEqual({
          ok: false,
          code: "not_found",
        });
      }
      expect(await db.shortlist.count()).toBe(0);
    });

    it("lets someone remove a project that has since gone offline, and hides it from their list", async () => {
      const a = await project("A");
      const b = await project("B");
      await setShortlisted(db, { userId, projectId: a.id, saved: true });
      await setShortlisted(db, { userId, projectId: b.id, saved: true });
      await db.project.update({ where: { id: a.id }, data: { status: "PAUSED" } });
      expect(
        (await listingsByIds(db, await listShortlistIds(db, userId))).map((c) => c.name),
      ).toEqual(["B"]);
      expect(await setShortlisted(db, { userId, projectId: a.id, saved: false })).toEqual({
        ok: true,
        saved: false,
      });
      expect(await db.shortlist.count()).toBe(1);
    });

    it("keeps each person's list separate and cleans up when a user or project is deleted", async () => {
      const other = await db.user.create({ data: { auth0Sub: "auth0|o", email: "o@example.com" } });
      const a = await project("A");
      await setShortlisted(db, { userId, projectId: a.id, saved: true });
      expect(await listShortlistIds(db, other.id)).toEqual([]);
      await db.project.delete({ where: { id: a.id } });
      expect(await db.shortlist.count()).toBe(0);
    });
  });
});
