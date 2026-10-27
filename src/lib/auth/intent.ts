import type { Role } from "@/generated/prisma/enums";
import { canBuild, homePathForMode, resolveMode, type Mode } from "@/lib/auth/mode";

// Which door someone walked through on the login page. It decides which of their accounts they are
// put into. It never decides what they may see: that comes from the accounts they really have. See
// docs/LOGIN-ROLES.md.

export type LoginIntent = "buyer" | "builder";

export const LOGIN_INTENTS: readonly LoginIntent[] = ["buyer", "builder"];

/** The intent from an address, or null for anything that is not exactly one of the two. */
export function parseIntent(value: unknown): LoginIntent | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return LOGIN_INTENTS.find((intent) => intent === raw) ?? null;
}

/**
 * The Auth0 address that starts a login through one of the two doors. Auth0 sends the person back
 * to /dashboard, which puts them in the right mode and sends them on (see resolveLogin).
 */
export function loginHref(
  intent: LoginIntent,
  options: {
    signup?: boolean;
    /** A page on this site to come back to after logging in. */ next?: string;
  } = {},
): string {
  const next = options.next ? `&next=${encodeURIComponent(options.next)}` : "";
  const returnTo = encodeURIComponent(`/dashboard?as=${intent}${next}`);
  return `/auth/login?${options.signup ? "screen_hint=signup&" : ""}returnTo=${returnTo}`;
}

/**
 * Which mode to put someone in and where to send them, right after they log in.
 *
 * - The buyer door always means the buyer account. Every email has one.
 * - The builder door means the builder account if the email has one, otherwise the page where it
 *   can create one (the mode stays buyer until it does).
 * - No door (a verification email, a plain protected page) keeps the mode they were last in.
 * - Staff always go to the console.
 */
export function resolveLogin(input: {
  storedRole: Role;
  intent: LoginIntent | null;
  currentMode: Mode | null;
}): { mode: Mode; path: string } {
  const { storedRole, intent, currentMode } = input;
  if (storedRole === "ADMIN") return { mode: "admin", path: homePathForMode("admin") };

  if (intent === "builder") {
    return canBuild(storedRole)
      ? { mode: "builder", path: homePathForMode("builder") }
      : { mode: "buyer", path: "/start-listing" };
  }
  if (intent === "buyer") return { mode: "buyer", path: homePathForMode("buyer") };

  const mode = resolveMode(storedRole, currentMode);
  return { mode, path: homePathForMode(mode) };
}
