import { NextResponse, type NextRequest } from "next/server";
import { getAuth0, isAuthConfigured } from "@/lib/auth0";
import { isProtectedPath } from "@/lib/auth/paths";

// Runs before every page. It mounts Auth0's /auth/login, /auth/callback and /auth/logout
// routes, keeps the session cookie fresh, and turns anonymous visits to private areas
// into a login redirect. Pages and server actions still re-check on the server.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const needsAuth = isProtectedPath(pathname) || pathname.startsWith("/auth/");

  if (!isAuthConfigured()) {
    // Public pages keep working before Auth0 is set up; private ones say why they cannot.
    return needsAuth
      ? new NextResponse("Authentication is not configured on this server yet.", { status: 503 })
      : NextResponse.next();
  }

  const auth0 = getAuth0();
  const response = await auth0.middleware(request);

  if (!isProtectedPath(pathname)) return response;

  const session = await auth0.getSession(request);
  if (!session) {
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(login);
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
