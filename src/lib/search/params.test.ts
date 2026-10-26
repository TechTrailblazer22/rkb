import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  escapeLike,
  filtersToParams,
  parseFilters,
  typeFromSlug,
} from "@/lib/search/params";

describe("parseFilters", () => {
  it("starts empty", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("reads every kind of filter", () => {
    const filters = parseFilters({
      q: "sulur",
      type: ["plots", "farm-houses"],
      stage: "ready-to-move",
      min: "2500000",
      max: "5000000",
      smin: "1000",
      smax: "2000",
      facing: ["east", "north-east"],
      approval: ["rera", "tncp"],
      verified: "1",
      amenity: ["park", "gym"],
      sort: "price_asc",
      page: "3",
    });
    expect(filters).toEqual({
      q: "sulur",
      city: "",
      types: ["PLOTTED", "FARM_HOUSE"],
      stages: ["READY_TO_MOVE"],
      budgetMin: 2500000,
      budgetMax: 5000000,
      sizeMin: 1000,
      sizeMax: 2000,
      facings: ["EAST", "NORTH_EAST"],
      approvals: ["RERA", "TNCP"],
      verifiedApprovals: true,
      amenities: ["park", "gym"],
      sort: "price_asc",
      page: 3,
    });
  });

  it("accepts comma separated lists as well as repeated parameters", () => {
    expect(parseFilters({ type: "plots,residential", amenity: "park,gym" })).toMatchObject({
      types: ["PLOTTED", "RESIDENTIAL"],
      amenities: ["park", "gym"],
    });
  });

  it("understands the single range the home page search box sends", () => {
    expect(parseFilters({ budget: "2500000-5000000" })).toMatchObject({
      budgetMin: 2500000,
      budgetMax: 5000000,
    });
    expect(parseFilters({ budget: "0-2500000" })).toMatchObject({
      budgetMin: 0,
      budgetMax: 2500000,
    });
    expect(parseFilters({ budget: "10000000-" })).toMatchObject({
      budgetMin: 10000000,
      budgetMax: null,
    });
    expect(parseFilters({ budget: "" })).toMatchObject({ budgetMin: null, budgetMax: null });
  });

  it("puts a reversed range the right way round", () => {
    expect(parseFilters({ min: "900", max: "100" })).toMatchObject({
      budgetMin: 100,
      budgetMax: 900,
    });
    expect(parseFilters({ smin: "3000", smax: "1000" })).toMatchObject({
      sizeMin: 1000,
      sizeMax: 3000,
    });
  });

  it("drops anything it does not recognise", () => {
    const filters = parseFilters({
      type: ["castle", "plots"],
      stage: "demolished",
      facing: "up",
      approval: "bribe",
      amenity: ["park", "helipad", "'; DROP TABLE Project;--"],
      sort: "random(); --",
      min: "-5",
      max: "1e9",
      smin: "abc",
      page: "-4",
    });
    expect(filters).toMatchObject({
      types: ["PLOTTED"],
      stages: [],
      facings: [],
      approvals: [],
      amenities: ["park"],
      sort: "newest",
      budgetMin: null,
      budgetMax: null,
      sizeMin: null,
      page: 1,
    });
  });

  it("clamps the page and the length of free text", () => {
    expect(parseFilters({ page: "999999" }).page).toBe(1);
    expect(parseFilters({ page: "500" }).page).toBe(500);
    expect(parseFilters({ q: "x".repeat(500) }).q).toHaveLength(80);
  });

  it("lets the page decide the city and type, whatever the address says", () => {
    const filters = parseFilters(
      { city: "Chennai", type: "commercial" },
      { city: "Coimbatore", types: ["PLOTTED"] },
    );
    expect(filters.city).toBe("Coimbatore");
    expect(filters.types).toEqual(["PLOTTED"]);
  });
});

describe("filtersToParams", () => {
  it("round trips what parseFilters read", () => {
    const original = parseFilters({
      q: "sulur",
      type: "plots",
      min: "100",
      facing: ["east", "west"],
      amenity: "park",
      sort: "available",
      page: "2",
    });
    expect(
      parseFilters(
        Object.fromEntries(filtersToParams(original).entries()) as Record<string, string>,
      ),
    ).toMatchObject({
      q: "sulur",
      types: ["PLOTTED"],
      budgetMin: 100,
      amenities: ["park"],
      sort: "available",
      page: 2,
    });
    expect(filtersToParams(original).getAll("facing")).toEqual(["east", "west"]);
  });

  it("leaves out defaults and anything asked to be omitted", () => {
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe("");
    const withCity = parseFilters({ page: "4", type: "plots" }, { city: "Coimbatore" });
    expect(filtersToParams(withCity, ["city", "types", "page"]).toString()).toBe("");
  });

  it("encodes special characters safely", () => {
    const params = filtersToParams(parseFilters({ q: "a&b=c#d" }));
    expect(params.toString()).toBe("q=a%26b%3Dc%23d");
  });
});

describe("activeFilterCount", () => {
  it("counts each filter group once", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount(
        parseFilters({ min: "1", max: "9", type: "plots", verified: "1", amenity: "park,gym" }),
      ),
    ).toBe(4);
  });

  it("does not count the sort, the page, or anything the page itself fixes", () => {
    expect(activeFilterCount(parseFilters({ sort: "price_asc", page: "3" }))).toBe(0);
    expect(activeFilterCount(parseFilters({}, { city: "Coimbatore" }), ["city"])).toBe(0);
  });
});

describe("helpers", () => {
  it("maps type slugs", () => {
    expect(typeFromSlug("plots")).toBe("PLOTTED");
    expect(typeFromSlug("Farm-Houses")).toBe("FARM_HOUSE");
    expect(typeFromSlug("castles")).toBeNull();
  });

  it("escapes the characters that act as wildcards in a text search", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("plain")).toBe("plain");
  });
});
