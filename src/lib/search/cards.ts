import type { PrismaClient } from "@/generated/prisma/client";
import { EMPTY_FILTERS, type SearchFilters } from "@/lib/search/params";
import { searchRows, type SearchRow } from "@/lib/search/query";
import { safePublicUrl } from "@/lib/storage/url";

/** Everything a project card needs. The same shape serves real listings and sample ones. */
export type ListingCardData = {
  id: string;
  slug: string | null;
  name: string;
  /** Short enough to sit on one line of a card. */
  typeLabel: string;
  typeKey: string;
  stageLabel: string;
  city: string | null;
  locality: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  pricePerSqft: number | null;
  sizeFrom: number | null;
  sizeTo: number | null;
  availablePlots: number;
  bookedPlots: number;
  soldPlots: number;
  totalPlots: number;
  approvals: { label: string; verified: boolean }[];
  builder: { name: string | null; slug: string | null; logoUrl: string | null };
  coverUrl: string | null;
  /** Paid placement (featured today, or a Premier company). Shown as "Featured". */
  promoted?: boolean;
  sample?: boolean;
};

// Card labels: the full names ("Under construction / development") do not fit on one line.
const TYPE_SHORT: Record<string, string> = {
  PLOTTED: "Plotted layout",
  FARM_HOUSE: "Farm house",
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  MIXED_USE: "Mixed use",
};
const STAGE_SHORT: Record<string, string> = {
  PRE_LAUNCH: "Pre-launch",
  UNDER_CONSTRUCTION: "Under construction",
  READY_TO_MOVE: "Ready to move",
};
const short = (labels: Record<string, string>, value: string) => labels[value] ?? value;

const APPROVAL_LABEL: Record<string, string> = {
  RERA: "RERA",
  TNCP: "TNCP",
  MUNICIPAL: "Municipal",
};

/** Search rows plus what is not in the search query: the cover photo and the approvals. */
export async function toCards(db: PrismaClient, rows: SearchRow[]): Promise<ListingCardData[]> {
  if (rows.length === 0) return [];
  const extras = await db.project.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true,
      approvals: { where: { number: { not: null } }, select: { kind: true, verified: true } },
      media: {
        where: { kind: "PHOTO" },
        orderBy: [{ isCover: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: { storageKey: true },
      },
    },
  });
  const byId = new Map(extras.map((e) => [e.id, e]));

  return rows.map((row) => {
    const extra = byId.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      typeKey: row.type,
      typeLabel: short(TYPE_SHORT, row.type),
      stageLabel: short(STAGE_SHORT, row.stage),
      city: row.city,
      locality: row.locality,
      priceFrom: row.priceFrom,
      priceTo: row.priceTo,
      pricePerSqft: row.pricePerSqft,
      sizeFrom: row.sizeFrom,
      sizeTo: row.sizeTo,
      availablePlots: row.available,
      bookedPlots: row.booked,
      soldPlots: row.sold,
      totalPlots: row.total,
      approvals: (extra?.approvals ?? [])
        .filter((a) => a.kind in APPROVAL_LABEL)
        .map((a) => ({ label: APPROVAL_LABEL[a.kind], verified: a.verified }))
        .slice(0, 3),
      builder: {
        name: row.companyName,
        slug: row.builderSlug,
        logoUrl: safePublicUrl(row.logoKey, 96),
      },
      coverUrl: safePublicUrl(extra?.media[0]?.storageKey, 640),
      promoted: row.promoted,
    };
  });
}

export async function searchListings(
  db: PrismaClient,
  filters: SearchFilters,
  options: { limit?: number; builderId?: string; spotlight?: boolean; plainNewest?: boolean } = {},
) {
  const { rows, total } = await searchRows(db, filters, options);
  return { cards: await toCards(db, rows), total };
}

/** The given projects, in the given order, skipping any that are no longer live. */
export async function listingsByIds(db: PrismaClient, ids: string[]): Promise<ListingCardData[]> {
  if (ids.length === 0) return [];
  const { rows } = await searchRows(db, EMPTY_FILTERS, { ids, limit: ids.length });
  const cards = await toCards(db, rows);
  const order = new Map(ids.map((id, index) => [id, index]));
  return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
