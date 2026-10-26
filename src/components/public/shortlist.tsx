"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Heart } from "lucide-react";

type ShortlistState = {
  /** null until the first answer arrives. */
  authenticated: boolean | null;
  /** False for builders and the admin: saving projects is a buyer feature, so no hearts. */
  canSave: boolean;
  saved: Set<string>;
  toggle: (projectId: string) => Promise<void>;
  busy: Set<string>;
};

const Context = createContext<ShortlistState | null>(null);

/**
 * Wrap the part of a page that has hearts. It asks the server once which projects the visitor
 * has saved, instead of every heart asking for itself.
 */
export function ShortlistProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [canSave, setCanSave] = useState(true);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/shortlist", { cache: "no-store", signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : { authenticated: false, canSave: true, ids: [] },
      )
      .then((data: { authenticated: boolean; canSave?: boolean; ids: string[] }) => {
        setAuthenticated(data.authenticated);
        setCanSave(data.canSave !== false);
        setSaved(new Set(data.ids));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setAuthenticated(false);
      });
    return () => controller.abort();
  }, []);

  const toggle = useCallback(
    async (projectId: string) => {
      if (authenticated === false) {
        // Not logged in: log in, then come back to this very page.
        // Read from the browser when the heart is pressed, not with a hook: reading the address
        // during rendering would make every page that has a heart render only in the browser,
        // and the page's content would be missing from the HTML that search engines read.
        const here = `${window.location.pathname}${window.location.search}`;
        // A full page load on purpose: /auth/login belongs to the Auth0 SDK, not to Next's router.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/auth/login?returnTo=${encodeURIComponent(here)}`;
        return;
      }
      const want = !saved.has(projectId);
      setBusy((current) => new Set(current).add(projectId));
      setSaved((current) => {
        const next = new Set(current);
        if (want) next.add(projectId);
        else next.delete(projectId);
        return next;
      });
      try {
        const response = await fetch("/api/shortlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, saved: want }),
        });
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        // Put the heart back how it was if the server did not accept the change.
        setSaved((current) => {
          const next = new Set(current);
          if (want) next.delete(projectId);
          else next.add(projectId);
          return next;
        });
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(projectId);
          return next;
        });
      }
    },
    [authenticated, saved],
  );

  const value = useMemo(
    () => ({ authenticated, canSave, saved, toggle, busy }),
    [authenticated, canSave, saved, toggle, busy],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function ShortlistHeart({
  projectId,
  name,
  variant = "overlay",
}: {
  projectId: string;
  name: string;
  variant?: "overlay" | "button";
}) {
  const state = useContext(Context);
  // Nothing until we know who is looking; and nothing for accounts that cannot save.
  if (!state || state.authenticated === null || !state.canSave) return null;
  const isSaved = state.saved.has(projectId);

  const common = {
    type: "button" as const,
    "aria-pressed": isSaved,
    "aria-label": isSaved ? `Remove ${name} from saved projects` : `Save ${name}`,
    disabled: state.busy.has(projectId),
    onClick: () => void state.toggle(projectId),
  };
  const icon = (
    <Heart
      className={`size-5 ${isSaved ? "fill-red-500 text-red-500" : "text-navy-900"}`}
      aria-hidden="true"
    />
  );

  if (variant === "button") {
    return (
      <button
        {...common}
        className="hover:bg-surface inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {icon}
        {isSaved ? "Saved" : "Save"}
      </button>
    );
  }
  return (
    <button
      {...common}
      data-testid="shortlist-heart"
      className="relative z-10 flex size-9 items-center justify-center rounded-full bg-white/95 shadow hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60"
    >
      {icon}
    </button>
  );
}
