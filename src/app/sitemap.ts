import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, getSiteUrl } from "@/lib/site";

// Resolved per request so URLs follow the deployed host, not the build machine.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: new URL(path, base).toString(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
