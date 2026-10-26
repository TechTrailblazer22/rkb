"use client";

import { Share2 } from "lucide-react";

/**
 * Opens the phone's share sheet where there is one, and WhatsApp otherwise. The link carries
 * the project's own address, so WhatsApp shows its preview picture and title.
 */
export function ShareButton({ title, text }: { title: string; text: string }) {
  async function share() {
    const url = window.location.origin + window.location.pathname;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return; // they closed it
      }
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      className="hover:bg-surface inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
    >
      <Share2 className="size-5" aria-hidden="true" />
      Share
    </button>
  );
}
