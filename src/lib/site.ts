/** Public base URL: explicit setting, then Render's injected URL, then local development. */
export function getSiteUrl(): URL {
  const raw =
    process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3000");
  }
}

/** Pages that search engines may index. Keep in sync with robots.ts (private areas are excluded there). */
export const PUBLIC_PATHS = [
  "/",
  "/projects",
  "/for-builders",
  "/pricing",
  "/terms",
  "/privacy",
  "/disclaimer",
];

/** Everything behind login or used by the app itself. */
export const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/dashboard",
  "/portal",
  "/admin",
  "/account",
  "/welcome",
  "/start-listing",
  "/login-continue",
];
