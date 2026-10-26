import Link from "next/link";
import { SearchX } from "lucide-react";
import { ShortlistProvider } from "@/components/public/shortlist";
import { FilterChips } from "@/components/search/filter-chips";
import { FiltersForm } from "@/components/search/filters-form";
import { ListingCard } from "@/components/search/listing-card";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";
import { getDb } from "@/lib/db";
import { searchListings } from "@/lib/search/cards";
import {
  PAGE_SIZE,
  SORTS,
  SORT_LABELS,
  activeFilterCount,
  filtersToParams,
  type SearchFilters,
} from "@/lib/search/params";

function href(
  basePath: string,
  filters: SearchFilters,
  fixed: (keyof SearchFilters)[],
  change: Partial<SearchFilters>,
) {
  const query = filtersToParams({ ...filters, ...change }, fixed).toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

/** Pages to link to: the first, the last, and a few around the current one. */
function pageWindow(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export async function SearchView({
  filters,
  basePath,
  fixed = [],
  heading,
  intro,
  quickLinks,
}: {
  filters: SearchFilters;
  /** The page's own address, without a query string. */
  basePath: string;
  /** Filters the page decides itself (they are left out of links and not shown as filters). */
  fixed?: (keyof SearchFilters)[];
  heading: string;
  intro?: string;
  quickLinks?: { href: string; label: string }[];
}) {
  const { cards, total } = await searchListings(getDb(), filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = activeFilterCount(filters, fixed) > 0;
  const nothingLiveYet = total === 0 && !filtered && fixed.length === 0;
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, filters.page * PAGE_SIZE);

  return (
    <Container className="py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        {basePath === "/projects" ? (
          <span>Projects</span>
        ) : (
          <Link href="/projects" className="hover:underline">
            Projects
          </Link>
        )}
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{heading}</h1>
        {intro && <p className="mt-2 max-w-2xl text-slate-600">{intro}</p>}
      </header>

      {nothingLiveYet ? (
        <div className="mx-auto mt-12 max-w-2xl text-center">
          <PlotGridArt live cols={12} rows={3} className="mx-auto max-w-sm" />
          <h2 className="mt-10 text-2xl font-extrabold tracking-tight">
            The project marketplace opens soon
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            We are onboarding verified builders right now. Their projects, with live plot
            availability, will appear here as they go live.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={LIST_PROJECT_HREF} className={buttonClass("primary", "lg")} data-for="builder">
              I&apos;m a builder, list my project
            </a>
            <Link href="/" className={buttonClass("secondary", "lg")}>
              Back to home
            </Link>
          </div>
        </div>
      ) : (
        <ShortlistProvider>
          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside>
              <FiltersForm filters={filters} action={basePath} fixed={fixed} />
            </aside>

            <section aria-label="Search results" className="min-w-0 space-y-5">
              <FilterChips filters={filters} basePath={basePath} fixed={fixed} />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold" data-testid="result-count" aria-live="polite">
                  {total === 0
                    ? "No projects found"
                    : `${total} ${total === 1 ? "project" : "projects"}${total > PAGE_SIZE ? ` (showing ${first} to ${last})` : ""}`}
                </p>
                <div
                  className="flex flex-wrap items-center gap-1 text-sm"
                  role="group"
                  aria-label="Sort results"
                >
                  <span className="mr-1 text-slate-500">Sort:</span>
                  {SORTS.map((sort) => (
                    <Link
                      key={sort}
                      href={href(basePath, filters, fixed, { sort, page: 1 })}
                      aria-current={filters.sort === sort ? "true" : undefined}
                      className={`rounded-full px-3 py-1.5 font-semibold ${filters.sort === sort ? "bg-navy-900 text-white" : "hover:bg-surface text-slate-700"}`}
                    >
                      {SORT_LABELS[sort]}
                    </Link>
                  ))}
                </div>
              </div>

              {cards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <SearchX className="mx-auto size-10 text-slate-400" aria-hidden="true" />
                  <h2 className="mt-3 text-lg font-bold">No projects match</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {filters.page > 1
                      ? "That page is past the last result."
                      : "Try removing a filter or widening your budget."}
                  </p>
                  <Link
                    href={filters.page > 1 ? href(basePath, filters, fixed, { page: 1 }) : basePath}
                    className={`${buttonClass("secondary")} mt-5`}
                  >
                    {filters.page > 1 ? "Go to the first page" : "Clear all filters"}
                  </Link>
                </div>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card, index) => (
                    <li key={card.id}>
                      <ListingCard card={card} priority={index < 2} titleAs="h2" />
                    </li>
                  ))}
                </ul>
              )}

              {pages > 1 && (
                <nav
                  aria-label="Result pages"
                  className="flex flex-wrap items-center justify-center gap-2 pt-2"
                >
                  {filters.page > 1 && (
                    <Link
                      rel="prev"
                      href={href(basePath, filters, fixed, { page: filters.page - 1 })}
                      className={buttonClass("secondary")}
                    >
                      Previous
                    </Link>
                  )}
                  {pageWindow(filters.page, pages).map((entry, i) =>
                    entry === "gap" ? (
                      <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-slate-400">
                        …
                      </span>
                    ) : (
                      <Link
                        key={entry}
                        href={href(basePath, filters, fixed, { page: entry })}
                        aria-current={entry === filters.page ? "page" : undefined}
                        aria-label={`Page ${entry}`}
                        className={`flex size-10 items-center justify-center rounded-lg text-sm font-semibold ${entry === filters.page ? "bg-navy-900 text-white" : "hover:bg-surface border border-slate-300"}`}
                      >
                        {entry}
                      </Link>
                    ),
                  )}
                  {filters.page < pages && (
                    <Link
                      rel="next"
                      href={href(basePath, filters, fixed, { page: filters.page + 1 })}
                      className={buttonClass("secondary")}
                    >
                      Next
                    </Link>
                  )}
                </nav>
              )}

              {quickLinks && quickLinks.length > 0 && (
                <nav aria-label="Browse more" className="border-t border-slate-200 pt-5">
                  <h2 className="text-sm font-bold">Browse more</h2>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {quickLinks.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="hover:bg-surface inline-block rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </section>
          </div>
        </ShortlistProvider>
      )}
    </Container>
  );
}
