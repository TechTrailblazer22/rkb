import type { AppUser } from "@/lib/auth/sync-user";
import { parseIntent, resolveLogin, type LoginIntent } from "@/lib/auth/intent";
import { homePathForMode, parseMode, type Mode } from "@/lib/auth/mode";
import { safeReturnTo } from "@/lib/auth/paths";

// Where a logged-in person goes next and which of their accounts they are put into. Used by the
// /dashboard and /switch routes and by the terms page, which must apply the same rules itself
// because a server action cannot hand a cookie back through a redirect to a route.

export type Landing = { path: string; mode: Mode | null };

/** After a login: the account for the door they came through (see resolveLogin). */
export function dashboardLanding(
  user: AppUser,
  intent: LoginIntent | null,
  next: unknown = null,
): Landing {
  const landing = resolveLogin({ storedRole: user.storedRole, intent, currentMode: user.mode });
  // Someone who logged in from a page (for example to send an enquiry) is taken back to it, but
  // only into the buyer account, and only to a page on this site.
  const back = safeReturnTo(typeof next === "string" ? next : null, "");
  if (back && landing.mode === "buyer" && landing.path === homePathForMode("buyer")) {
    return { ...landing, path: back };
  }
  return landing;
}

/**
 * For the switch button and for hand-overs from an address (`fromLink`). The person must really
 * have the account they ask for. `mode` is null when the account should not change.
 */
export function switchLanding(
  user: AppUser,
  input: { to: unknown; next: unknown; fromLink: boolean },
): Landing {
  const target = parseMode(input.to);
  const back = safeReturnTo(typeof input.next === "string" ? input.next : null, "");
  const stay: Landing = { path: homePathForMode(user.mode), mode: null };

  // Staff have a single mode, and only buyer and builder can be asked for.
  if (target !== "buyer" && target !== "builder") return stay;
  if (!user.modes.includes(target)) {
    // Pressing "Create a builder account" leads to the page that creates one. Opening a builder
    // address without having one just goes home.
    return target === "builder" && user.storedRole !== "ADMIN" && !input.fromLink
      ? { path: "/start-listing", mode: null }
      : stay;
  }
  return { path: back || homePathForMode(target), mode: target };
}

/**
 * The page the terms page should continue to. If that is /dashboard or /switch, their rules are
 * applied here (and the account to remember is returned), instead of redirecting to them.
 */
export function landingAfterConsent(user: AppUser, destination: string): Landing {
  const url = new URL(destination, "http://placeholder.invalid");
  if (url.pathname === "/dashboard") {
    return dashboardLanding(
      user,
      parseIntent(url.searchParams.get("as")),
      url.searchParams.get("next"),
    );
  }
  if (url.pathname === "/switch") {
    return switchLanding(user, {
      to: url.searchParams.get("to"),
      next: url.searchParams.get("next"),
      fromLink: url.searchParams.get("link") === "1",
    });
  }
  return { path: destination, mode: null };
}
