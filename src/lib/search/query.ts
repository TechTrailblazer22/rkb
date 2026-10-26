import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { escapeLike, PAGE_SIZE, type SearchFilters, type SortKey } from "@/lib/search/params";

// The marketplace search. A project shows up only when it is LIVE and its builder is still
// VERIFIED, so suspending a builder removes their projects from search at once.
//
// Prices, sizes and availability are worked out from the plots inside the query itself, not
// copied into extra columns, so search can never disagree with what the builder just edited.
// Every value reaches the database as a parameter. Only the sort order is written into the
// text, and only from a fixed list.

export type SearchRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  stage: string;
  city: string | null;
  locality: string | null;
  publishedAt: Date | null;
  priceFrom: number | null;
  priceTo: number | null;
  pricePerSqft: number | null;
  sizeFrom: number | null;
  sizeTo: number | null;
  total: number;
  available: number;
  companyName: string | null;
  builderSlug: string | null;
  logoKey: string | null;
};

const SORT_SQL: Record<SortKey, Prisma.Sql> = {
  newest: Prisma.sql`p."publishedAt" DESC NULLS LAST, p.id`,
  price_asc: Prisma.sql`COALESCE(p."budgetFrom", s.pmin) ASC NULLS LAST, p.id`,
  price_desc: Prisma.sql`COALESCE(p."budgetTo", s.pmax) DESC NULLS LAST, p.id`,
  available: Prisma.sql`s.available DESC, p."publishedAt" DESC NULLS LAST, p.id`,
};

const SOURCE = Prisma.sql`
  FROM "Project" p
  JOIN "Builder" b ON b.id = p."builderId"
  LEFT JOIN LATERAL (
    SELECT MIN(pl.price) AS pmin, MAX(pl.price) AS pmax,
           MIN(pl."sizeSqft") AS smin, MAX(pl."sizeSqft") AS smax,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE pl.status = 'AVAILABLE')::int AS available
    FROM "Plot" pl
    WHERE pl."projectId" = p.id
  ) s ON TRUE`;

const BAND_FROM = Prisma.sql`COALESCE(p."budgetFrom", s.pmin)`;
const BAND_TO = Prisma.sql`COALESCE(p."budgetTo", s.pmax)`;

function conditions(filters: SearchFilters, ids?: string[], builderId?: string): Prisma.Sql[] {
  const where: Prisma.Sql[] = [
    Prisma.sql`p.status = 'LIVE'`,
    Prisma.sql`b.status = 'VERIFIED'`,
    Prisma.sql`p.slug IS NOT NULL`,
  ];

  if (ids) where.push(Prisma.sql`p.id = ANY(${ids})`);
  if (builderId) where.push(Prisma.sql`p."builderId" = ${builderId}`);
  if (filters.city) where.push(Prisma.sql`LOWER(p.city) = LOWER(${filters.city})`);

  // Every word has to match somewhere: "green valley sulur" finds Green Valley in Sulur.
  const words = filters.q.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const word of words) {
    const pattern = `%${escapeLike(word)}%`;
    where.push(
      Prisma.sql`(p.name ILIKE ${pattern} OR p.locality ILIKE ${pattern} OR p.city ILIKE ${pattern} OR b."companyName" ILIKE ${pattern})`,
    );
  }

  if (filters.types.length) where.push(Prisma.sql`p.type::text = ANY(${filters.types})`);
  if (filters.stages.length) where.push(Prisma.sql`p.stage::text = ANY(${filters.stages})`);

  // A project matches a budget when its price band overlaps the range. No prices, no match.
  if (filters.budgetMin !== null) where.push(Prisma.sql`${BAND_TO} >= ${filters.budgetMin}`);
  if (filters.budgetMax !== null) where.push(Prisma.sql`${BAND_FROM} <= ${filters.budgetMax}`);
  if (filters.sizeMin !== null) where.push(Prisma.sql`s.smax >= ${filters.sizeMin}`);
  if (filters.sizeMax !== null) where.push(Prisma.sql`s.smin <= ${filters.sizeMax}`);

  // Facing counts only for plots that can still be bought.
  if (filters.facings.length) {
    where.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Plot" f WHERE f."projectId" = p.id AND f.status = 'AVAILABLE' AND f.facing::text = ANY(${filters.facings}))`,
    );
  }

  // Each ticked approval must be present, with a number. "Verified only" also needs our check.
  for (const kind of filters.approvals) {
    where.push(
      filters.verifiedApprovals
        ? Prisma.sql`EXISTS (SELECT 1 FROM "ProjectApproval" a WHERE a."projectId" = p.id AND a.kind::text = ${kind} AND a.number IS NOT NULL AND a.verified)`
        : Prisma.sql`EXISTS (SELECT 1 FROM "ProjectApproval" a WHERE a."projectId" = p.id AND a.kind::text = ${kind} AND a.number IS NOT NULL)`,
    );
  }
  if (filters.verifiedApprovals && filters.approvals.length === 0) {
    where.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "ProjectApproval" a WHERE a."projectId" = p.id AND a.kind IN ('RERA','TNCP','MUNICIPAL') AND a.number IS NOT NULL AND a.verified)`,
    );
  }

  if (filters.amenities.length) where.push(Prisma.sql`p.amenities @> ${filters.amenities}::text[]`);
  return where;
}

export async function searchRows(
  db: PrismaClient,
  filters: SearchFilters,
  options: { ids?: string[]; limit?: number; builderId?: string } = {},
): Promise<{ rows: SearchRow[]; total: number }> {
  const where = Prisma.join(conditions(filters, options.ids, options.builderId), " AND ");
  const limit = options.limit ?? PAGE_SIZE;
  const offset = options.ids ? 0 : (filters.page - 1) * limit;

  const [rows, count] = await Promise.all([
    db.$queryRaw<SearchRow[]>`
      SELECT p.id, p.slug, p.name, p.type::text AS type, p.stage::text AS stage, p.city, p.locality,
             p."publishedAt", ${BAND_FROM} AS "priceFrom", ${BAND_TO} AS "priceTo",
             p."pricePerSqft", s.smin AS "sizeFrom", s.smax AS "sizeTo",
             COALESCE(s.total, 0) AS total, COALESCE(s.available, 0) AS available,
             b."companyName", b.slug AS "builderSlug", b."logoKey"
      ${SOURCE}
      WHERE ${where}
      ORDER BY ${SORT_SQL[filters.sort]}
      LIMIT ${limit} OFFSET ${offset}`,
    db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n ${SOURCE} WHERE ${where}`,
  ]);
  return { rows, total: count[0]?.n ?? 0 };
}
