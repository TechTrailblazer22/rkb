import { cache } from "react";
import { getDb } from "@/lib/db";
import { searchListings } from "@/lib/search/cards";
import type { SearchFilters } from "@/lib/search/params";

// A search page asks the same question twice in one request: once for its title (how many projects)
// and once for the list. React's cache() makes the second ask free, within the request only.
const run = cache(async (key: string) => searchListings(getDb(), JSON.parse(key) as SearchFilters));

/** The search results for these filters, computed at most once per request. */
export const searchOnce = (filters: SearchFilters) => run(JSON.stringify(filters));
