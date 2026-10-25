// Paths that need a logged-in user. The proxy redirects anonymous visitors to login;
// pages and server actions still re-check on the server, the proxy is only the first gate.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/portal",
  "/admin",
  "/account",
  "/welcome",
  "/start-listing",
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Accepts only same-site relative paths, so a crafted `?returnTo=` cannot bounce a
 * user to another site after login (open redirect). Anything else gets the fallback.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//evil.com" and "/\evil.com" are treated by browsers as protocol-relative URLs
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // control characters (tab/newline/CR) can be stripped by browsers and change meaning
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
