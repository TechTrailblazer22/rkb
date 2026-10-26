import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { PlotFacing, PlotStatus, ProjectStage, ProjectType } from "@/generated/prisma/enums";
import { listingsByIds, searchListings } from "@/lib/search/cards";
import { EMPTY_FILTERS, parseFilters } from "@/lib/search/params";
import { searchRows } from "@/lib/search/query";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md):
//   TEST_DATABASE_URL=postgresql://... npm test
const url = process.env.TEST_DATABASE_URL;

type PlotSeed = {
  size: number;
  price?: number | null;
  status?: PlotStatus;
  facing?: PlotFacing | null;
};

describe.skipIf(!url)("marketplace search (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let counter = 0;

  beforeEach(async () => {
    await db.shortlist.deleteMany();
    await db.plotStatusLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    counter = 0;
    builderId = (await newBuilder("Anand Realty")).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function newBuilder(name: string, status: "VERIFIED" | "SUSPENDED" | "DRAFT" = "VERIFIED") {
    return db.builder.create({
      data: { companyName: name, status, slug: name.toLowerCase().replace(/\W+/g, "-") },
    });
  }

  async function project(
    name: string,
    plots: PlotSeed[] = [{ size: 1200, price: 2_000_000 }],
    data: {
      status?: "LIVE" | "DRAFT" | "PAUSED" | "CHANGES_REQUESTED" | "ARCHIVED";
      city?: string | null;
      locality?: string | null;
      type?: ProjectType;
      stage?: ProjectStage;
      builder?: string;
      slug?: string | null;
      amenities?: string[];
      budgetFrom?: number | null;
      budgetTo?: number | null;
      approvals?: {
        kind: "RERA" | "TNCP" | "MUNICIPAL" | "BANK_LOAN";
        verified?: boolean;
        number?: string | null;
      }[];
      publishedAt?: Date;
    } = {},
  ) {
    counter++;
    const created = await db.project.create({
      data: {
        builderId: data.builder ?? builderId,
        name,
        type: data.type ?? "PLOTTED",
        stage: data.stage ?? "READY_TO_MOVE",
        status: data.status ?? "LIVE",
        city: data.city === undefined ? "Coimbatore" : data.city,
        locality: data.locality === undefined ? "Sulur" : data.locality,
        slug: data.slug === undefined ? `project-${counter}` : data.slug,
        amenities: data.amenities ?? [],
        budgetFrom: data.budgetFrom ?? null,
        budgetTo: data.budgetTo ?? null,
        publishedAt: data.publishedAt ?? new Date(Date.UTC(2026, 0, counter)),
        approvals: {
          create: (data.approvals ?? []).map((a) => ({
            kind: a.kind,
            number: a.number === undefined ? `${a.kind}/1` : a.number,
            verified: a.verified ?? false,
          })),
        },
        plots: {
          create: plots.map((p, i) => ({
            number: `P-${i + 1}`,
            sortKey: `p-${String(i + 1).padStart(8, "0")}`,
            sizeSqft: p.size,
            price: p.price === undefined ? null : p.price,
            status: p.status ?? "AVAILABLE",
            facing: p.facing ?? null,
          })),
        },
      },
    });
    return created;
  }

  const search = async (raw: Record<string, string | string[]> = {}) => {
    const { cards, total } = await searchListings(db, parseFilters(raw));
    return { names: cards.map((c) => c.name), total, cards };
  };

  describe("what is listed at all", () => {
    it("lists only live projects of verified builders", async () => {
      const suspended = await newBuilder("Suspended Co", "SUSPENDED");
      const unverified = await newBuilder("Draft Co", "DRAFT");
      await project("Shown");
      await project("Draft project", [{ size: 1000 }], { status: "DRAFT" });
      await project("Paused project", [{ size: 1000 }], { status: "PAUSED" });
      await project("Changes project", [{ size: 1000 }], { status: "CHANGES_REQUESTED" });
      await project("Archived project", [{ size: 1000 }], { status: "ARCHIVED" });
      await project("Suspended builder project", [{ size: 1000 }], { builder: suspended.id });
      await project("Unverified builder project", [{ size: 1000 }], { builder: unverified.id });
      await project("No slug yet", [{ size: 1000 }], { slug: null });
      expect((await search()).names).toEqual(["Shown"]);
    });

    it("drops a project from search the moment its builder is suspended", async () => {
      await project("Visible");
      expect((await search()).total).toBe(1);
      await db.builder.update({ where: { id: builderId }, data: { status: "SUSPENDED" } });
      expect((await search()).total).toBe(0);
    });

    it("computes counts and prices from the plots as they are right now", async () => {
      const p = await project("Counted", [
        { size: 1000, price: 2_000_000 },
        { size: 1500, price: 3_500_000, status: "BOOKED" },
        { size: 2000, price: 5_000_000, status: "SOLD" },
        { size: 1200, price: null, status: "HELD" },
      ]);
      const { cards } = await search();
      expect(cards[0]).toMatchObject({
        availablePlots: 1,
        totalPlots: 4,
        priceFrom: 2_000_000,
        priceTo: 5_000_000,
        sizeFrom: 1000,
        sizeTo: 2000,
      });
      await db.plot.updateMany({
        where: { projectId: p.id, status: "SOLD" },
        data: { status: "AVAILABLE" },
      });
      expect((await search()).cards[0].availablePlots).toBe(2);
    });

    it("prefers the builder's own price band over the plots'", async () => {
      await project("Banded", [{ size: 1000, price: 9_000_000 }], {
        budgetFrom: 1_000_000,
        budgetTo: 2_000_000,
      });
      expect((await search()).cards[0]).toMatchObject({ priceFrom: 1_000_000, priceTo: 2_000_000 });
      expect((await search({ max: "2000000" })).names).toEqual(["Banded"]);
      expect((await search({ min: "8000000" })).names).toEqual([]);
    });
  });

  describe("filters", () => {
    it("filters by city, ignoring case", async () => {
      await project("Coimbatore one");
      await project("Chennai one", [{ size: 1000 }], { city: "Chennai" });
      expect(
        (await searchListings(db, parseFilters({}, { city: "COIMBATORE" }))).cards.map(
          (c) => c.name,
        ),
      ).toEqual(["Coimbatore one"]);
    });

    it("filters by type and stage, singly and together", async () => {
      await project("Plots ready", [{ size: 1000 }], { type: "PLOTTED", stage: "READY_TO_MOVE" });
      await project("Farm pre", [{ size: 1000 }], { type: "FARM_HOUSE", stage: "PRE_LAUNCH" });
      await project("Flats", [{ size: 1000 }], {
        type: "RESIDENTIAL",
        stage: "UNDER_CONSTRUCTION",
      });
      expect((await search({ type: "farm-houses" })).names).toEqual(["Farm pre"]);
      expect((await search({ type: ["plots", "residential"] })).total).toBe(2);
      expect((await search({ stage: "pre-launch" })).names).toEqual(["Farm pre"]);
      expect((await search({ type: "plots", stage: "pre-launch" })).total).toBe(0);
    });

    it("matches a budget when the price band overlaps it, including the edges", async () => {
      await project("Cheap", [
        { size: 1000, price: 2_000_000 },
        { size: 1000, price: 3_000_000 },
      ]);
      await project("Mid", [
        { size: 1000, price: 5_000_000 },
        { size: 1000, price: 6_000_000 },
      ]);
      await project("Dear", [{ size: 1000, price: 9_000_000 }]);
      await project("Unpriced", [{ size: 1000, price: null }]);

      expect((await search({ min: "4000000", max: "7000000" })).names).toEqual(["Mid"]);
      expect((await search({ min: "2500000", max: "5500000" })).names.sort()).toEqual([
        "Cheap",
        "Mid",
      ]);
      expect((await search({ max: "2000000" })).names).toEqual(["Cheap"]); // band starts exactly at the limit
      expect((await search({ min: "9000000" })).names).toEqual(["Dear"]); // band ends exactly at the limit
      expect((await search({ min: "9000001" })).names).toEqual([]);
      expect((await search({})).total).toBe(4); // with no budget, unpriced projects are still listed
      expect((await search({ min: "0" })).names).not.toContain("Unpriced");
    });

    it("filters by plot size the same way", async () => {
      await project("Small", [{ size: 800 }, { size: 1000 }]);
      await project("Large", [{ size: 2400 }, { size: 3000 }]);
      expect((await search({ smin: "2000" })).names).toEqual(["Large"]);
      expect((await search({ smax: "900" })).names).toEqual(["Small"]);
      expect((await search({ smin: "900", smax: "2500" })).names.sort()).toEqual([
        "Large",
        "Small",
      ]);
    });

    it("counts facing only for plots that can still be bought", async () => {
      await project("East available", [
        { size: 1000, facing: "EAST" },
        { size: 1000, facing: "WEST" },
      ]);
      await project("East sold", [
        { size: 1000, facing: "EAST", status: "SOLD" },
        { size: 1000, facing: "WEST" },
      ]);
      expect((await search({ facing: "east" })).names).toEqual(["East available"]);
      expect((await search({ facing: ["east", "west"] })).total).toBe(2);
      expect((await search({ facing: "north" })).total).toBe(0);
    });

    it("requires every ticked approval, and our verification when asked", async () => {
      await project("Both verified", [{ size: 1000 }], {
        approvals: [
          { kind: "RERA", verified: true },
          { kind: "TNCP", verified: true },
        ],
      });
      await project("RERA unverified", [{ size: 1000 }], { approvals: [{ kind: "RERA" }] });
      await project("TNCP only", [{ size: 1000 }], {
        approvals: [{ kind: "TNCP", verified: true }],
      });
      await project("Blank number", [{ size: 1000 }], {
        approvals: [{ kind: "RERA", verified: true, number: null }],
      });
      await project("Bank loan only", [{ size: 1000 }], {
        approvals: [{ kind: "BANK_LOAN", verified: true }],
      });
      await project("None");

      expect((await search({ approval: "rera" })).names.sort()).toEqual([
        "Both verified",
        "RERA unverified",
      ]);
      expect((await search({ approval: ["rera", "tncp"] })).names).toEqual(["Both verified"]);
      expect((await search({ approval: "rera", verified: "1" })).names).toEqual(["Both verified"]);
      expect((await search({ verified: "1" })).names.sort()).toEqual([
        "Both verified",
        "TNCP only",
      ]);
    });

    it("requires every ticked amenity", async () => {
      await project("Park and gym", [{ size: 1000 }], { amenities: ["park", "gym", "security"] });
      await project("Park only", [{ size: 1000 }], { amenities: ["park"] });
      expect((await search({ amenity: "park" })).total).toBe(2);
      expect((await search({ amenity: ["park", "gym"] })).names).toEqual(["Park and gym"]);
      expect((await search({ amenity: ["park", "swimming_pool"] })).total).toBe(0);
    });
  });

  describe("text search", () => {
    beforeEach(async () => {
      await project("Green Valley Enclave", [{ size: 1000 }], {
        locality: "Sulur",
        city: "Coimbatore",
      });
      await project("Lakeview Farms", [{ size: 1000 }], {
        locality: "Chengalpattu",
        city: "Chennai",
      });
    });

    it("finds by project name, locality, city and builder name", async () => {
      expect((await search({ q: "green" })).names).toEqual(["Green Valley Enclave"]);
      expect((await search({ q: "chengal" })).names).toEqual(["Lakeview Farms"]);
      expect((await search({ q: "CHENNAI" })).names).toEqual(["Lakeview Farms"]);
      expect((await search({ q: "anand" })).total).toBe(2);
    });

    it("needs every word to match, in any column", async () => {
      expect((await search({ q: "valley sulur" })).names).toEqual(["Green Valley Enclave"]);
      expect((await search({ q: "valley chennai" })).total).toBe(0);
    });

    it("treats wildcards and quotes as plain text", async () => {
      expect((await search({ q: "%" })).total).toBe(0);
      expect((await search({ q: "_" })).total).toBe(0);
      expect((await search({ q: "gr_en" })).total).toBe(0);
      expect((await search({ q: "o'brien" })).total).toBe(0);
      expect((await search({ q: '\'; DROP TABLE "Project"; --' })).total).toBe(0);
      expect((await search({})).total).toBe(2); // and nothing was dropped
    });
  });

  describe("sorting and paging", () => {
    it("sorts by price, by availability and by newest", async () => {
      await project(
        "Mid",
        [
          { size: 1000, price: 5_000_000 },
          { size: 1000, status: "SOLD" },
        ],
        { publishedAt: new Date("2026-02-01") },
      );
      await project(
        "Cheap",
        [
          { size: 1000, price: 2_000_000 },
          { size: 1000, price: 2_500_000 },
          { size: 1000, price: 2_100_000 },
        ],
        { publishedAt: new Date("2026-03-01") },
      );
      await project("Dear", [{ size: 1000, price: 9_000_000 }], {
        publishedAt: new Date("2026-01-01"),
      });
      expect((await search({ sort: "price_asc" })).names).toEqual(["Cheap", "Mid", "Dear"]);
      expect((await search({ sort: "price_desc" })).names).toEqual(["Dear", "Mid", "Cheap"]);
      expect((await search({ sort: "available" })).names[0]).toBe("Cheap");
      expect((await search({ sort: "newest" })).names).toEqual(["Cheap", "Mid", "Dear"]);
    });

    it("treats an unknown sort as the default, never as SQL", async () => {
      await project("One");
      await project("Two");
      expect((await search({ sort: "1; DROP TABLE x" })).total).toBe(2);
    });

    it("pages through every project once, in a stable order", async () => {
      for (let i = 1; i <= 30; i++)
        await project(`Project ${String(i).padStart(2, "0")}`, [{ size: 1000, price: 1_000_000 }]);
      const pages = [
        await search({ page: "1" }),
        await search({ page: "2" }),
        await search({ page: "3" }),
      ];
      expect(pages.map((p) => p.names.length)).toEqual([12, 12, 6]);
      expect(pages.every((p) => p.total === 30)).toBe(true);
      const everyName = pages.flatMap((p) => p.names);
      expect(new Set(everyName).size).toBe(30);
      expect((await search({ page: "4" })).names).toEqual([]);
      expect((await search({ page: "4" })).total).toBe(30);
      // the same query twice gives the same order, even when prices tie
      expect((await search({ sort: "price_asc", page: "2" })).names).toEqual(
        (await search({ sort: "price_asc", page: "2" })).names,
      );
    });
  });

  describe("cards", () => {
    it("brings the cover photo and approval badges, and no other approval types", async () => {
      const p = await project("With extras", [{ size: 1000, price: 2_000_000 }], {
        approvals: [
          { kind: "RERA", verified: true },
          { kind: "BANK_LOAN", verified: true },
          { kind: "TNCP" },
        ],
      });
      await db.projectMedia.createMany({
        data: [
          {
            projectId: p.id,
            kind: "PHOTO",
            storageKey: "builders/b1/public/projects/p/photo-a.jpg",
            originalName: "a.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            uploadedById: "u",
            isCover: false,
          },
          {
            projectId: p.id,
            kind: "PHOTO",
            storageKey: "builders/b1/public/projects/p/photo-cover.jpg",
            originalName: "c.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            uploadedById: "u",
            isCover: true,
          },
          {
            projectId: p.id,
            kind: "BROCHURE",
            storageKey: "builders/b1/public/projects/p/brochure.pdf",
            originalName: "b.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            uploadedById: "u",
          },
        ],
      });
      const [card] = (await search()).cards;
      expect(card.coverUrl).toContain("photo-cover.jpg");
      expect(card.approvals.map((a) => a.label).sort()).toEqual(["RERA", "TNCP"]);
      expect(card.approvals.find((a) => a.label === "RERA")?.verified).toBe(true);
      expect(card.builder).toMatchObject({ name: "Anand Realty", slug: "anand-realty" });
    });

    it("has no cover address when there are no photos", async () => {
      await project("Bare");
      expect((await search()).cards[0].coverUrl).toBeNull();
    });

    it("returns saved projects in the order asked for, skipping ones no longer live", async () => {
      const a = await project("A");
      const b = await project("B");
      const c = await project("C", [{ size: 1000 }], { status: "PAUSED" });
      const cards = await listingsByIds(db, [c.id, b.id, a.id, "missing"]);
      expect(cards.map((x) => x.name)).toEqual(["B", "A"]);
    });
  });

  it("does the same with the plain search call used by the pages", async () => {
    await project("Direct");
    const { rows, total } = await searchRows(db, EMPTY_FILTERS);
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ name: "Direct", total: 1, available: 1 });
  });
});
