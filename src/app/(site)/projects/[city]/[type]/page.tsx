import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SearchView } from "@/components/search/search-view";
import { searchMetadata } from "@/components/search/search-meta";
import { getDb } from "@/lib/db";
import { parseFilters, TYPE_NAMES, typeFromSlug } from "@/lib/search/params";
import { cityFromSlug } from "@/lib/search/public";
import { searchRows } from "@/lib/search/query";

const FIXED = ["city", "types"] as const;

async function resolve(params: PageProps<"/projects/[city]/[type]">["params"]) {
  const { city: citySlug, type: typeSlug } = await params;
  const [city, type] = [await cityFromSlug(citySlug), typeFromSlug(typeSlug)];
  return city && type ? { city, type } : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/projects/[city]/[type]">): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return { title: "Projects not found", robots: { index: false } };
  const filters = parseFilters(await searchParams, { city: found.city.name, types: [found.type] });
  const { total } = await searchRows(getDb(), filters, { limit: 1 });
  const name = `${TYPE_NAMES[found.type]} in ${found.city.name}`;
  return searchMetadata({
    title: name,
    description: `${name} from verified builders, with live plot availability and verified approvals.`,
    basePath: `/projects/${found.city.slug}/${(await params).type.toLowerCase()}`,
    filters,
    fixed: [...FIXED],
    total,
  });
}

export default async function CityTypePage({
  params,
  searchParams,
}: PageProps<"/projects/[city]/[type]">) {
  const found = await resolve(params);
  if (!found) notFound();
  const filters = parseFilters(await searchParams, { city: found.city.name, types: [found.type] });

  return (
    <SearchView
      filters={filters}
      basePath={`/projects/${found.city.slug}/${(await params).type.toLowerCase()}`}
      fixed={[...FIXED]}
      heading={`${TYPE_NAMES[found.type]} in ${found.city.name}`}
      intro={`Verified ${TYPE_NAMES[found.type].toLowerCase()} in ${found.city.name}, with live plot availability.`}
      quickLinks={[
        { href: `/projects/${found.city.slug}`, label: `All projects in ${found.city.name}` },
      ]}
    />
  );
}
