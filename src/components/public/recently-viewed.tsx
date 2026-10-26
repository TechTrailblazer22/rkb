"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";

type Entry = { slug: string; name: string; place: string; price: string };

const KEY = "rkb.recently-viewed";
const MAX = 6;
const EMPTY = "[]";

function parse(raw: string): Entry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.slug === "string" &&
        typeof e.name === "string",
    );
  } catch {
    return [];
  }
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? EMPTY;
  } catch {
    return EMPTY; // private windows and blocked storage: simply show nothing
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Remembers, in this browser only, that this project was opened. Nothing is sent anywhere. */
export function TrackView({ entry }: { entry: Entry }) {
  useEffect(() => {
    try {
      const next = [entry, ...parse(readRaw()).filter((e) => e.slug !== entry.slug)].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: nothing to remember
    }
  }, [entry]);
  return null;
}

export function RecentlyViewed({ exclude, className }: { exclude?: string; className?: string }) {
  // The server renders the empty list; the browser then switches to what it remembers.
  const raw = useSyncExternalStore(subscribe, readRaw, () => EMPTY);
  const entries = useMemo(() => parse(raw).filter((e) => e.slug !== exclude), [raw, exclude]);
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className={className}>
      <h2 id="recent-heading" className="text-xl font-bold">
        Recently viewed
      </h2>
      <ul className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {entries.map((entry) => (
          <li key={entry.slug} className="shrink-0">
            <Link
              href={`/project/${entry.slug}`}
              className="block w-56 rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-500"
            >
              <span className="block truncate font-semibold">{entry.name}</span>
              <span className="block truncate text-sm text-slate-600">{entry.place}</span>
              <span className="mt-1 block text-sm font-bold text-teal-700">{entry.price}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
