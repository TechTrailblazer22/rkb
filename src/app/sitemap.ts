import type { MetadataRoute } from "next";
import { TYPE_SLUGS } from "@/lib/search/params";
import { listSitemapEntries } from "@/lib/search/public";
import { slugify } from "@/lib/builders/slug";
import { PUBLIC_PATHS, getSiteUrl } from "@/lib/site";

// Resolved per request so URLs follow the deployed host, not the build machine, and so a project
// that has just gone live is listed straight away.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const abs = (path: string) => new URL(path, base).toString();

  const entries: MetadataRoute.Sitemap = PUBLIC_PATHS.map((path) => ({
    url: abs(path),
    changeFrequency: path === "/" ? "daily" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));

  try {
    const { projects, builders, cities, combos } = await listSitemapEntries();
    for (const city of cities)
      entries.push({ url: abs(`/projects/${city.slug}`), changeFrequency: "daily", priority: 0.8 });
    const seen = new Set<string>();
    for (const combo of combos) {
      const citySlug = combo.city ? slugify(combo.city) : "";
      const typeSlug = TYPE_SLUGS[combo.type as keyof typeof TYPE_SLUGS];
      const path = `/projects/${citySlug}/${typeSlug}`;
      if (!citySlug || !typeSlug || seen.has(path)) continue;
      seen.add(path);
      entries.push({ url: abs(path), changeFrequency: "daily", priority: 0.7 });
    }
    for (const project of projects)
      if (project.slug)
        entries.push({
          url: abs(`/project/${project.slug}`),
          lastModified: project.updatedAt,
          changeFrequency: "daily",
          priority: 0.9,
        });
    for (const builder of builders)
      if (builder.slug)
        entries.push({
          url: abs(`/builder/${builder.slug}`),
          lastModified: builder.updatedAt,
          changeFrequency: "weekly",
          priority: 0.6,
        });
  } catch (error) {
    // The fixed pages are still worth listing if the database cannot be reached.
    console.error("sitemap: could not list projects", error);
  }
  return entries;
}
