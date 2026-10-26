import type { PlotFacing, ProjectStage, ProjectType } from "@/generated/prisma/enums";
import { AMENITY_CODES } from "@/lib/projects/amenities";

// Search filters live in the address bar, so a search can be bookmarked, shared on WhatsApp and
// indexed. This file is the only place that reads them: anything unrecognised is dropped and
// numbers are clamped, because the result goes straight into a database query.

export const TYPE_SLUGS: Record<ProjectType, string> = {
  PLOTTED: "plots",
  FARM_HOUSE: "farm-houses",
  RESIDENTIAL: "residential",
  COMMERCIAL: "commercial",
  MIXED_USE: "mixed-use",
};

export const TYPE_NAMES: Record<ProjectType, string> = {
  PLOTTED: "Plots",
  FARM_HOUSE: "Farm houses",
  RESIDENTIAL: "Residential projects",
  COMMERCIAL: "Commercial projects",
  MIXED_USE: "Mixed-use projects",
};

export const STAGE_SLUGS: Record<ProjectStage, string> = {
  PRE_LAUNCH: "pre-launch",
  UNDER_CONSTRUCTION: "under-construction",
  READY_TO_MOVE: "ready-to-move",
};

export const FACING_SLUGS: Record<PlotFacing, string> = {
  NORTH: "north",
  SOUTH: "south",
  EAST: "east",
  WEST: "west",
  NORTH_EAST: "north-east",
  NORTH_WEST: "north-west",
  SOUTH_EAST: "south-east",
  SOUTH_WEST: "south-west",
};

export const APPROVAL_SLUGS = { RERA: "rera", TNCP: "tncp", MUNICIPAL: "municipal" } as const;
export type SearchApproval = keyof typeof APPROVAL_SLUGS;

export const SORTS = ["newest", "price_asc", "price_desc", "available"] as const;
export type SortKey = (typeof SORTS)[number];
export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  available: "Most plots available",
};

export const PAGE_SIZE = 12;
const MAX_PAGE = 500;
const MAX_MONEY = 100_000_000_000;
const MAX_SIZE = 10_000_000;

export type SearchFilters = {
  /** Free text: matches project name, locality, city or builder name. */
  q: string;
  /** Exact city (any case). Set by the city pages, or typed in the filter form. */
  city: string;
  types: ProjectType[];
  stages: ProjectStage[];
  budgetMin: number | null;
  budgetMax: number | null;
  sizeMin: number | null;
  sizeMax: number | null;
  facings: PlotFacing[];
  approvals: SearchApproval[];
  verifiedApprovals: boolean;
  amenities: string[];
  sort: SortKey;
  page: number;
};

export const EMPTY_FILTERS: SearchFilters = {
  q: "",
  city: "",
  types: [],
  stages: [],
  budgetMin: null,
  budgetMax: null,
  sizeMin: null,
  sizeMax: null,
  facings: [],
  approvals: [],
  verifiedApprovals: false,
  amenities: [],
  sort: "newest",
  page: 1,
};

export type RawParams = Record<string, string | string[] | undefined>;

const all = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);

const first = (value: string | string[] | undefined): string => all(value)[0] ?? "";

function reverse<K extends string>(table: Record<K, string>): Map<string, K> {
  return new Map((Object.entries(table) as [K, string][]).map(([key, slug]) => [slug, key]));
}
const typeBySlug = reverse(TYPE_SLUGS);
const stageBySlug = reverse(STAGE_SLUGS);
const facingBySlug = reverse(FACING_SLUGS);
const approvalBySlug = new Map(
  (Object.entries(APPROVAL_SLUGS) as [SearchApproval, string][]).map(([k, v]) => [v, k]),
);

function pick<T>(values: string[], lookup: Map<string, T>): T[] {
  const found = new Set<T>();
  for (const value of values) {
    const hit = lookup.get(value.toLowerCase());
    if (hit !== undefined) found.add(hit);
  }
  return [...found];
}

function whole(value: string, max: number): number | null {
  if (!/^\d{1,12}$/.test(value)) return null;
  const n = Number(value);
  return n >= 0 && n <= max ? n : null;
}

/**
 * The filters in an address, made safe. `fixed` is what the page itself decides, such as the
 * city on /projects/coimbatore. It wins over anything in the query string.
 */
export function parseFilters(raw: RawParams, fixed: Partial<SearchFilters> = {}): SearchFilters {
  let budgetMin = whole(first(raw.min), MAX_MONEY);
  let budgetMax = whole(first(raw.max), MAX_MONEY);

  // The home page search box sends a single range such as "2500000-5000000" or "10000000-".
  const legacy = /^(\d{0,12})-(\d{0,12})$/.exec(first(raw.budget));
  if (legacy && budgetMin === null && budgetMax === null) {
    budgetMin = legacy[1] ? whole(legacy[1], MAX_MONEY) : null;
    budgetMax = legacy[2] ? whole(legacy[2], MAX_MONEY) : null;
  }
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax)
    [budgetMin, budgetMax] = [budgetMax, budgetMin];

  let sizeMin = whole(first(raw.smin), MAX_SIZE);
  let sizeMax = whole(first(raw.smax), MAX_SIZE);
  if (sizeMin !== null && sizeMax !== null && sizeMin > sizeMax)
    [sizeMin, sizeMax] = [sizeMax, sizeMin];

  const sort = SORTS.find((s) => s === first(raw.sort)) ?? EMPTY_FILTERS.sort;
  const page = Math.min(MAX_PAGE, Math.max(1, whole(first(raw.page), MAX_PAGE) ?? 1));

  const parsed: SearchFilters = {
    q: first(raw.q).slice(0, 80),
    city: first(raw.city).slice(0, 60),
    types: pick(all(raw.type), typeBySlug),
    stages: pick(all(raw.stage), stageBySlug),
    budgetMin,
    budgetMax,
    sizeMin,
    sizeMax,
    facings: pick(all(raw.facing), facingBySlug),
    approvals: pick(all(raw.approval), approvalBySlug),
    verifiedApprovals: first(raw.verified) === "1",
    amenities: [...new Set(all(raw.amenity).filter((code) => AMENITY_CODES.has(code)))],
    sort,
    page,
  };
  return { ...parsed, ...fixed };
}

/** Filters back into an address, leaving out anything that is at its default. */
export function filtersToParams(
  filters: SearchFilters,
  omit: (keyof SearchFilters)[] = [],
): URLSearchParams {
  const params = new URLSearchParams();
  const skip = new Set(omit);
  const put = (
    key: keyof SearchFilters,
    name: string,
    value: string | number | null | undefined,
  ) => {
    if (skip.has(key) || value === null || value === undefined || value === "") return;
    params.set(name, String(value));
  };

  put("q", "q", filters.q);
  put("city", "city", filters.city);
  if (!skip.has("types")) for (const t of filters.types) params.append("type", TYPE_SLUGS[t]);
  if (!skip.has("stages")) for (const s of filters.stages) params.append("stage", STAGE_SLUGS[s]);
  put("budgetMin", "min", filters.budgetMin);
  put("budgetMax", "max", filters.budgetMax);
  put("sizeMin", "smin", filters.sizeMin);
  put("sizeMax", "smax", filters.sizeMax);
  if (!skip.has("facings"))
    for (const f of filters.facings) params.append("facing", FACING_SLUGS[f]);
  if (!skip.has("approvals"))
    for (const a of filters.approvals) params.append("approval", APPROVAL_SLUGS[a]);
  if (filters.verifiedApprovals && !skip.has("verifiedApprovals")) params.set("verified", "1");
  if (!skip.has("amenities")) for (const a of filters.amenities) params.append("amenity", a);
  if (filters.sort !== EMPTY_FILTERS.sort && !skip.has("sort")) params.set("sort", filters.sort);
  if (filters.page > 1 && !skip.has("page")) params.set("page", String(filters.page));
  return params;
}

/** How many filters are active, for the "Filters (3)" button. The sort and page do not count. */
export function activeFilterCount(
  filters: SearchFilters,
  ignore: (keyof SearchFilters)[] = [],
): number {
  const skip = new Set(ignore);
  let count = 0;
  const on = (key: keyof SearchFilters, active: boolean) => {
    if (active && !skip.has(key)) count++;
  };
  on("q", filters.q !== "");
  on("city", filters.city !== "");
  on("types", filters.types.length > 0);
  on("stages", filters.stages.length > 0);
  on("budgetMin", filters.budgetMin !== null || filters.budgetMax !== null);
  on("sizeMin", filters.sizeMin !== null || filters.sizeMax !== null);
  on("facings", filters.facings.length > 0);
  on("approvals", filters.approvals.length > 0);
  on("verifiedApprovals", filters.verifiedApprovals);
  on("amenities", filters.amenities.length > 0);
  return count;
}

/** "plots" -> PLOTTED, for the /projects/<city>/<type> pages. */
export function typeFromSlug(slug: string): ProjectType | null {
  return typeBySlug.get(slug.toLowerCase()) ?? null;
}

/** Escapes % and _ so that what a visitor types is matched literally, not as a pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
