import type { MetadataRoute } from "next";

// Lets a phone offer "Add to home screen". There is no service worker: the app still needs a
// connection, which is right for live plot availability.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RKB Platform",
    short_name: "RKB",
    description: "Verified builders, live plot availability, direct enquiries.",
    start_url: "/projects",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b2545",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
