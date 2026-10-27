import type { NextRequest } from "next/server";
import { parseIntent } from "@/lib/auth/intent";
import { dashboardLanding } from "@/lib/auth/landing";
import { withModeCookie } from "@/lib/auth/mode-cookie";
import { safeReturnTo } from "@/lib/auth/paths";
import { requireUser } from "@/lib/auth/session";
import { redirectTo } from "@/lib/http";

// Where every login ends. `?as=buyer|builder` is the door chosen on /login: it decides which of the
// person's accounts they are put into (see resolveLogin). Without it they keep the account they
// were last in. Anything else in the address is ignored. A route handler rather than a page,
// because it has to set the cookie that remembers the account.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const intent = parseIntent(params.get("as"));
  const next = safeReturnTo(params.get("next"), "");
  const returnTo = `/dashboard${intent ? `?as=${intent}` : ""}${next ? `${intent ? "&" : "?"}next=${encodeURIComponent(next)}` : ""}`;
  const user = await requireUser({ returnTo });
  const { mode, path } = dashboardLanding(user, intent, next);
  const response = redirectTo(path);
  return mode ? withModeCookie(response, mode) : response;
}
