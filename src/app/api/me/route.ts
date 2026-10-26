import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MODE_COOKIE } from "@/lib/auth/mode";
import { withModeCookie } from "@/lib/auth/mode-cookie";
import { getSessionAccount, getSessionUser } from "@/lib/auth/session";

// Tells the static site header whether the visitor is logged in, and which account they are using,
// so public pages can stay cacheable.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
  } catch (error) {
    // A broken session must never break the header: treat it as logged out.
    console.error("Could not read session for /api/me", error);
  }

  // Only for people who are logged in with a verified email; everyone else costs no database read.
  const account = user?.email_verified === true ? await getSessionAccount() : null;

  const response = NextResponse.json(
    {
      authenticated: Boolean(user),
      emailVerified: user?.email_verified === true,
      name: user?.name ?? user?.email ?? null,
      /** BUYER, BUILDER_OWNER, BUILDER_TEAM or ADMIN, for the mode in use. Only changes the header. */
      role: account?.role ?? null,
      /** The account in use ("buyer", "builder" or "admin"), and whether a builder account exists. */
      mode: account?.mode ?? null,
      canBuild: account?.canBuild ?? false,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );

  // Keep the cookie in step with what the server decided (for example a first visit with no
  // cookie, or a cookie asking for an account the person does not have).
  if (account && request.cookies.get(MODE_COOKIE)?.value !== account.mode) {
    withModeCookie(response, account.mode);
  }
  return response;
}
