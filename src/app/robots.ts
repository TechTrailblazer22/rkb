import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, getSiteUrl } from "@/lib/site";

// Resolved per request so the sitemap URL follows the deployed host, not the build machine.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).toString(),
  };
}
