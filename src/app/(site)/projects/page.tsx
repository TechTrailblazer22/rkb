import type { Metadata } from "next";
import { SearchView } from "@/components/search/search-view";
import { searchMetadata } from "@/components/search/search-meta";
import { RecentlyViewed } from "@/components/public/recently-viewed";
import { Container } from "@/components/ui/container";
import { getDb } from "@/lib/db";
import { parseFilters, TYPE_NAMES, TYPE_SLUGS } from "@/lib/search/params";
import { listCities } from "@/lib/search/public";
import { searchRows } from "@/lib/search/query";

const HEADING = "Projects for sale";
const DESCRIPTION =
  "Browse plots, farm houses, residential and commercial projects from verified builders, with live plot availability and verified approvals.";

export async function generateMetadata({
  searchParams,
}: PageProps<"/projects">): Promise<Metadata> {
  const filters = parseFilters(await searchParams);
  const { total } = await searchRows(getDb(), filters, { limit: 1 });
  return searchMetadata({
    title: HEADING,
    description: DESCRIPTION,
    basePath: "/projects",
    filters,
    total,
  });
}

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const filters = parseFilters(await searchParams);
  const cities = (await listCities()).slice(0, 8);

  return (
    <>
      <SearchView
        filters={filters}
        basePath="/projects"
        heading={HEADING}
        intro="Every project here is from a verified builder. Plot availability is updated by the builder."
        quickLinks={[
          ...cities.map((city) => ({
            href: `/projects/${city.slug}`,
            label: `Projects in ${city.name}`,
          })),
          ...Object.entries(TYPE_SLUGS).map(([type, slug]) => ({
            href: `/projects?type=${slug}`,
            label: TYPE_NAMES[type as keyof typeof TYPE_NAMES],
          })),
        ]}
      />
      <Container className="pb-12">
        <RecentlyViewed />
      </Container>
    </>
  );
}
