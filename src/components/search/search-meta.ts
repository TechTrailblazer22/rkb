import type { Metadata } from "next";
import { activeFilterCount, EMPTY_FILTERS, type SearchFilters } from "@/lib/search/params";

/**
 * Titles and rules for search engines. The plain page for a city or type is worth indexing;
 * every combination of filters, sort orders and page numbers is not (there are endless
 * variations of the same results), so those are kept out of the index and point back to the
 * plain page as the canonical one.
 */
export function searchMetadata(input: {
  title: string;
  description: string;
  basePath: string;
  filters: SearchFilters;
  fixed?: (keyof SearchFilters)[];
  total: number;
}): Metadata {
  const { filters, fixed = [] } = input;
  const variation =
    activeFilterCount(filters, fixed) > 0 ||
    filters.sort !== EMPTY_FILTERS.sort ||
    filters.page > 1;
  const indexable = !variation && input.total > 0;

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.basePath },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: input.title, description: input.description, url: input.basePath },
  };
}
