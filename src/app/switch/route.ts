import type { NextRequest } from "next/server";
import { switchLanding } from "@/lib/auth/landing";
import { parseMode } from "@/lib/auth/mode";
import { withModeCookie } from "@/lib/auth/mode-cookie";
import { safeReturnTo } from "@/lib/auth/paths";
import { requireUser } from "@/lib/auth/session";
import { redirectTo } from "@/lib/http";

// Moves a logged-in person between their buyer account and their builder account without logging
// out. The switch button at the top of every page goes here. A page that belongs to the other
// account sends people here too (a link in an email, a bookmark), with `next` set to the page they
// wanted and `link=1`.
//
// It changes only which account is shown, which is a display preference. The person must really
// have the account they ask for (see switchLanding). It is a GET on purpose: every redirect it
// makes (to log in, to accept the terms) then works without replaying a form post.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = parseMode(params.get("to"));
  const next = safeReturnTo(params.get("next"), "");
  const fromLink = params.get("link") === "1";

  const user = await requireUser({
    returnTo: `/switch?to=${to ?? ""}${fromLink ? "&link=1" : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}`,
  });
  const { mode, path } = switchLanding(user, { to, next, fromLink });
  const response = redirectTo(path);
  return mode ? withModeCookie(response, mode) : response;
}
