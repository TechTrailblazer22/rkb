"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { classifyPath, classifyReferrer, type Source, SOURCES } from "@/lib/usage/site-kinds";

/**
 * Counts anonymous visits for the admin's Usage page. Renders nothing. It sends, at most, the kind of
 * page, where the visit came from (one word) and whether this is the session's first page or first
 * page of that kind: no address, no identifier, no cookie. It remembers only in sessionStorage (gone
 * when the tab closes) that it has already counted, and it does nothing if the browser asks not to be
 * tracked. Pages that are not counted (the admin console, the API) are skipped.
 */
export function SiteBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (
        navigator.doNotTrack === "1" ||
        (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl
      ) {
        return;
      }
      const page = classifyPath(pathname);
      if (!page) return;

      let source = sessionStorage.getItem("rkb:src") as Source | null;
      const firstOfSession = source === null || !SOURCES.includes(source);
      if (firstOfSession) {
        source = classifyReferrer(document.referrer, location.host);
        sessionStorage.setItem("rkb:src", source);
      }
      const pageKey = `rkb:page:${page}`;
      const newPage = sessionStorage.getItem(pageKey) === null;
      if (!firstOfSession && !newPage) return;
      sessionStorage.setItem(pageKey, "1");

      void fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, source, newVisit: firstOfSession, newPage }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // counting must never break a page (private mode can make sessionStorage throw)
    }
  }, [pathname]);

  return null;
}
