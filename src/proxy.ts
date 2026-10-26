import { NextResponse, type NextRequest } from "next/server";
import { getAuth0, isAuthConfigured, missingAuthEnv } from "@/lib/auth0";
import { isProtectedPath } from "@/lib/auth/paths";
import { MODE_COOKIE, areaMode, parseMode, redirectForMode } from "@/lib/auth/mode";
import { absoluteRedirect } from "@/lib/http";

// Log the problem once per server process instead of on every request.
let warnedAboutAuth = false;

// Runs before every page. It mounts Auth0's /auth/login, /auth/callback and /auth/logout
// routes, keeps the session cookie fresh, and turns anonymous visits to private areas
// into a login redirect. Pages and server actions still re-check on the server.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const needsAuth = isProtectedPath(pathname) || pathname.startsWith("/auth/");

  if (!isAuthConfigured()) {
    // The visitor sees a generic message; the exact names go to the server log (Render > Logs).
    if (needsAuth && !warnedAboutAuth) {
      warnedAboutAuth = true;
      console.error(
        `Auth0 is not configured. Missing or empty environment variables: ${missingAuthEnv().join(", ")}`,
      );
    }
    // Public pages keep working before Auth0 is set up; private ones say why they cannot.
    return needsAuth
      ? new NextResponse("Authentication is not configured on this server yet.", { status: 503 })
      : NextResponse.next();
  }

  const auth0 = getAuth0();
  const response = await auth0.middleware(request);

  if (!isProtectedPath(pathname)) {
    // A logged-in buyer is kept off the builder marketing pages and a logged-in builder off the
    // buyer pages (see docs/LOGIN-ROLES.md). Done here, before the page, so the pages themselves
    // stay cached. The cookie only says which account was in use; without a session it means
    // nothing, so anonymous visitors (even with a leftover cookie) see everything.
    const mode = parseMode(request.cookies.get(MODE_COOKIE)?.value);
    const target = mode ? redirectForMode(mode, pathname) : null;
    if (target && (await auth0.getSession(request))) return absoluteRedirect(request, target);
    return response;
  }

  const session = await auth0.getSession(request);
  if (!session) {
    // Not built from request.url: on Render that is the internal address (localhost:10000).
    // Next requires an absolute URL in the proxy, so use the public origin.
    return absoluteRedirect(
      request,
      `/auth/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`,
    );
  }

  // A page that belongs to the person's other account (a link in an email, a bookmark): go through
  // the switch, with the full address, so they arrive on that very page. Done here because only
  // the proxy sees the whole path; a layout only knows its own. /switch checks they really have
  // that account, and `link=1` makes it send people without one to their own home.
  const mode = parseMode(request.cookies.get(MODE_COOKIE)?.value);
  const area = areaMode(pathname);
  if (mode && area && mode !== area && mode !== "admin") {
    return absoluteRedirect(
      request,
      `/switch?to=${area}&link=1&next=${encodeURIComponent(`${pathname}${search}`)}`,
    );
  }
  return response;
}

export const config = {
  matcher: [
    // Broad on purpose (the SDK needs it for rolling sessions). Health checks are
    // excluded so they can never be affected by auth problems.
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/health).*)",
  ],
};
