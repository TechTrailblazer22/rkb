"use client";

import { useEffect } from "react";

type Source = "direct" | "search" | "home" | "builder" | "external";

function sourceOfVisit(): Source {
  try {
    if (!document.referrer) return "direct";
    const from = new URL(document.referrer);
    if (from.host !== location.host) return "external";
    if (from.pathname === "/") return "home";
    if (from.pathname.startsWith("/projects")) return "search";
    if (from.pathname.startsWith("/builder")) return "builder";
    return "direct";
  } catch {
    return "direct";
  }
}

function send(slug: string, event: "VIEW" | "CALL" | "WHATSAPP", source: Source) {
  try {
    const payload = JSON.stringify({ slug, event, source });
    // fetch with keepalive survives leaving the page; unlike sendBeacon it can set the content type.
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the page
  }
}

/**
 * Counts a page view (once per browser session per project) and clicks on the call and WhatsApp
 * buttons (anything marked data-track). Renders nothing. It stores nothing in the browser beyond
 * a session flag that stops the same visit being counted again on a refresh.
 */
export function AnalyticsBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const source = sourceOfVisit();
    const key = `rkb:viewed:${slug}`;
    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === "1";
      if (!seen) sessionStorage.setItem(key, "1");
    } catch {
      // no session storage: count the view, at worst a refresh counts again
    }
    if (!seen) send(slug, "VIEW", source);

    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest?.("[data-track]");
      const kind = target?.getAttribute("data-track");
      if (kind === "CALL" || kind === "WHATSAPP") send(slug, kind, source);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [slug]);
  return null;
}
