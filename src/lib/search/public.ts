import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { slugify } from "@/lib/builders/slug";
import { searchListings, type ListingCardData } from "@/lib/search/cards";
import { EMPTY_FILTERS } from "@/lib/search/params";
import { loadProjectView, type ProjectViewData } from "@/lib/projects/view";
import { safePublicUrl } from "@/lib/storage/url";

// What the world may see. A project is public only when it is LIVE and its builder is
// VERIFIED. Every public page reads through these functions, so that rule lives in one place.

const PUBLIC_PROJECT = {
  status: "LIVE",
  slug: { not: null },
  builder: { status: "VERIFIED" },
} as const;

/** Up to this many plots are sent to the browser for the page's own filtering and search. */
export const PUBLIC_PLOT_LIMIT = 300;

export type PublicProject = ProjectViewData & {
  similar: ListingCardData[];
  publishedAt: Date | null;
};

export async function loadPublicProject(slug: string): Promise<PublicProject | null> {
  const db = getDb();
  const found = await db.project.findFirst({
    where: { ...PUBLIC_PROJECT, slug },
    select: { id: true, city: true, type: true, publishedAt: true },
  });
  if (!found) return null;

  const [data, similar] = await Promise.all([
    loadProjectView(found.id, { plotLimit: PUBLIC_PLOT_LIMIT }),
    found.city
      ? searchListings(
          db,
          { ...EMPTY_FILTERS, city: found.city, types: [found.type] },
          { limit: 4 },
        )
      : Promise.resolve({ cards: [] as ListingCardData[], total: 0 }),
  ]);
  if (!data) return null;
  return {
    ...data,
    publishedAt: found.publishedAt,
    similar: similar.cards.filter((c) => c.id !== found.id).slice(0, 3),
  };
}

export type PublicBuilder = {
  id: string;
  slug: string;
  companyName: string;
  about: string | null;
  website: string | null;
  yearEstablished: number | null;
  projectsCompleted: number | null;
  projectsOngoing: number | null;
  serviceCities: string[];
  city: string | null;
  state: string | null;
  verifiedAt: Date | null;
  logoUrl: string | null;
  coverUrl: string | null;
};

/** Only what a buyer should see. Never PAN, GSTIN, the street address, phone or documents. */
export async function loadPublicBuilder(slug: string): Promise<PublicBuilder | null> {
  const builder = await getDb().builder.findFirst({
    where: { slug, status: "VERIFIED" },
    select: {
      id: true,
      slug: true,
      companyName: true,
      about: true,
      website: true,
      yearEstablished: true,
      projectsCompleted: true,
      projectsOngoing: true,
      serviceCities: true,
      city: true,
      state: true,
      verifiedAt: true,
      logoKey: true,
      coverKey: true,
    },
  });
  if (!builder?.slug || !builder.companyName) return null;
  return {
    id: builder.id,
    slug: builder.slug,
    companyName: builder.companyName,
    about: builder.about,
    website: builder.website,
    yearEstablished: builder.yearEstablished,
    projectsCompleted: builder.projectsCompleted,
    projectsOngoing: builder.projectsOngoing,
    serviceCities: builder.serviceCities,
    city: builder.city,
    state: builder.state,
    verifiedAt: builder.verifiedAt,
    logoUrl: safePublicUrl(builder.logoKey, 160),
    coverUrl: safePublicUrl(builder.coverKey, 1200),
  };
}

export type CityEntry = { name: string; slug: string; count: number };

/**
 * Cities that have at least one public project. A city is spelled however builders typed it, so
 * "Coimbatore" and "coimbatore" are one entry (counted together, shown in the most common spelling).
 */
export async function listCities(db: PrismaClient = getDb()): Promise<CityEntry[]> {
  const rows = await db.project.groupBy({
    by: ["city"],
    where: { ...PUBLIC_PROJECT, city: { not: null } },
    _count: { _all: true },
  });
  const merged = new Map<string, CityEntry & { best: number }>();
  for (const row of rows) {
    const name = row.city?.trim();
    const slug = name ? slugify(name) : "";
    if (!name || !slug) continue;
    const entry = merged.get(slug);
    if (!entry) merged.set(slug, { name, slug, count: row._count._all, best: row._count._all });
    else {
      entry.count += row._count._all;
      if (row._count._all > entry.best) Object.assign(entry, { name, best: row._count._all });
    }
  }
  return [...merged.values()]
    .map(({ name, slug, count }) => ({ name, slug, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "coimbatore" to "Coimbatore", but only for cities that really have projects. */
export async function cityFromSlug(slug: string): Promise<CityEntry | null> {
  return (await listCities()).find((city) => city.slug === slug.toLowerCase()) ?? null;
}

/** Everything the sitemap lists. */
export async function listSitemapEntries(db: PrismaClient = getDb()) {
  const [projects, builders, cities, combos] = await Promise.all([
    db.project.findMany({
      where: PUBLIC_PROJECT,
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    }),
    db.builder.findMany({
      where: { status: "VERIFIED", slug: { not: null } },
      select: { slug: true, updatedAt: true },
      take: 2000,
    }),
    listCities(db),
    db.project.groupBy({ by: ["city", "type"], where: { ...PUBLIC_PROJECT, city: { not: null } } }),
  ]);
  return { projects, builders, cities, combos };
}
