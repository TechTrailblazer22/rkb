// How a page address and a referrer are sorted into the few groups the anonymous visit counters use.
// Pure, no imports, so the browser and the server use exactly the same rules.

export const PAGE_KINDS = [
  "home",
  "search",
  "project",
  "builder",
  "marketing",
  "login",
  "account",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const PAGE_LABELS: Record<PageKind, string> = {
  home: "Home page",
  search: "Project search",
  project: "A project page",
  builder: "A builder's page",
  marketing: "Pricing and for-builders pages",
  login: "Login",
  account: "Buyer or builder account area",
};

export const SOURCES = ["direct", "search_engine", "social", "other"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  direct: "Typed the address, or a bookmark or shared link",
  search_engine: "A search engine",
  social: "Social media or messaging",
  other: "Another website",
};

export const parsePageKind = (value: unknown): PageKind | null =>
  PAGE_KINDS.find((k) => k === value) ?? null;
export const parseSource = (value: unknown): Source | null =>
  SOURCES.find((s) => s === value) ?? null;

/**
 * The kind of page an address is, or null for places that are never counted: the admin console, the
 * API, the login machinery, and plumbing pages nobody "visits".
 */
export function classifyPath(pathname: string): PageKind | null {
  const path = pathname.split("?")[0].split("#")[0];
  const first = path.split("/")[1] ?? "";
  if (path === "/" || path === "") return "home";
  switch (first) {
    case "projects":
      return "search";
    case "project":
      return "project";
    case "builder":
      return "builder";
    case "for-builders":
    case "pricing":
    case "terms":
    case "privacy":
    case "disclaimer":
      return "marketing";
    case "login":
      return "login";
    case "account":
    case "portal":
      return "account";
    default:
      return null;
  }
}

// Whole registered domains, optionally with a subdomain in front, so a look-alike host such as
// "google.evil.example" or "notgoogle.com.evil.example" is not taken for the real thing.
const SEARCH_ENGINES =
  /^([a-z0-9-]+\.)*(google\.(com|co\.[a-z]{2}|[a-z]{2})|bing\.com|duckduckgo\.com|yahoo\.(com|co\.in)|baidu\.com|yandex\.(com|ru)|ecosia\.org|brave\.com)$/;
const SOCIAL =
  /^([a-z0-9-]+\.)*(facebook\.com|fb\.com|instagram\.com|whatsapp\.com|wa\.me|t\.me|telegram\.org|twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|pinterest\.com|reddit\.com)$/;

/** Where a visit came from, from the referrer's host. Nothing but this one word is kept. */
export function classifyReferrer(referrer: string, ownHost: string): Source {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).host.toLowerCase();
  } catch {
    return "direct";
  }
  if (host === ownHost.toLowerCase()) return "direct";
  if (SEARCH_ENGINES.test(host)) return "search_engine";
  if (SOCIAL.test(host)) return "social";
  return "other";
}
