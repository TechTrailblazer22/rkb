import { NextResponse } from "next/server";

// Why this file exists: behind a proxy such as Render, the server only knows its own internal
// address (https://localhost:10000). Anything built from `request.url` therefore points at a
// dead address once deployed. There are two safe ways to redirect, depending on where you are.

function isSitePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

/**
 * For route handlers and server code: redirect with a relative Location header. The browser
 * resolves it against the address it actually used, so it is right on every host.
 *
 * Do NOT use this in proxy.ts: Next requires an absolute URL there (see absoluteRedirect).
 */
export function redirectTo(path: string, status: 301 | 302 | 303 | 307 | 308 = 307): NextResponse {
  if (!isSitePath(path)) {
    throw new Error(`redirectTo only accepts a path on this site, got: ${path}`);
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}

/**
 * The address visitors actually use: the configured public URL when there is one (set
 * APP_BASE_URL, or rely on Render's RENDER_EXTERNAL_URL), otherwise the request's own origin,
 * which is correct in local development.
 */
export function publicOrigin(
  request: { nextUrl: { origin: string } },
  env: Record<string, string | undefined> = process.env,
): string {
  for (const candidate of [env.APP_BASE_URL, env.RENDER_EXTERNAL_URL]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // a malformed value is ignored, the next source is tried
    }
  }
  return request.nextUrl.origin;
}

/** For proxy.ts: an absolute redirect to a path on this site, on the public address. */
export function absoluteRedirect(
  request: { nextUrl: { origin: string } },
  path: string,
  env: Record<string, string | undefined> = process.env,
): NextResponse {
  if (!isSitePath(path)) {
    throw new Error(`absoluteRedirect only accepts a path on this site, got: ${path}`);
  }
  return NextResponse.redirect(new URL(path, publicOrigin(request, env)));
}
