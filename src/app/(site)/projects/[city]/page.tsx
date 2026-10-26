import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SearchView } from "@/components/search/search-view";
import { searchMetadata } from "@/components/search/search-meta";
import { getDb } from "@/lib/db";
import { parseFilters, TYPE_NAMES, TYPE_SLUGS } from "@/lib/search/params";
import { cityFromSlug } from "@/lib/search/public";
import { searchRows } from "@/lib/search/query";

const FIXED = ["city"] as const;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/projects/[city]">): Promise<Metadata> {
  const city = await cityFromSlug((await params).city);
  if (!city) return { title: "Projects not found", robots: { index: false } };
  const filters = parseFilters(await searchParams, { city: city.name });
  const { total } = await searchRows(getDb(), filters, { limit: 1 });
  return searchMetadata({
    title: `Projects in ${city.name}`,
    description: `Browse ${city.count} verified ${city.count === 1 ? "project" : "projects"} in ${city.name}: plots, farm houses, residential and commercial, with live plot availability and verified approvals.`,
    basePath: `/projects/${city.slug}`,
    filters,
    fixed: [...FIXED],
    total,
  });
}

export default async function CityPage({ params, searchParams }: PageProps<"/projects/[city]">) {
  const city = await cityFromSlug((await params).city);
  if (!city) notFound();
  const filters = parseFilters(await searchParams, { city: city.name });

  return (
    <SearchView
      filters={filters}
      basePath={`/projects/${city.slug}`}
      fixed={[...FIXED]}
      heading={`Projects in ${city.name}`}
      intro={`Verified builders and projects in ${city.name}, with live plot availability.`}
      quickLinks={Object.entries(TYPE_SLUGS).map(([type, slug]) => ({
        href: `/projects/${city.slug}/${slug}`,
        label: `${TYPE_NAMES[type as keyof typeof TYPE_NAMES]} in ${city.name}`,
      }))}
    />
  );
}
