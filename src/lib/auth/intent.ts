import type { Role } from "@/generated/prisma/enums";
import { homePathForRole } from "@/lib/auth/roles";

// Which door someone walked through on the login page. It decides where they are sent and what is
// explained to them. It never decides what they may see: that always comes from User.role on the
// server. See docs/LOGIN-ROLES.md.

export type LoginIntent = "buyer" | "builder";

export const LOGIN_INTENTS: readonly LoginIntent[] = ["buyer", "builder"];

/** The intent from an address, or null for anything that is not exactly one of the two. */
export function parseIntent(value: unknown): LoginIntent | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return LOGIN_INTENTS.find((intent) => intent === raw) ?? null;
}

/**
 * The Auth0 address that starts a login through one of the two doors. Auth0 sends the person back
 * to /dashboard, which sends them on to the right area (see landingFor).
 */
export function loginHref(intent: LoginIntent, options: { signup?: boolean } = {}): string {
  const returnTo = encodeURIComponent(`/dashboard?as=${intent}`);
  return `/auth/login?${options.signup ? "screen_hint=signup&" : ""}returnTo=${returnTo}`;
}

/** Messages shown once on the page someone lands on after logging in through the wrong door. */
export const LANDING_NOTICES = {
  "builder-account": {
    title: "This is a builder account",
    body: "You used the buyer option, but this email belongs to a builder account, so you are in the builder portal. To search and save projects as a buyer, use a different email address.",
  },
} as const;

export type LandingNotice = keyof typeof LANDING_NOTICES;

export function parseNotice(value: unknown): LandingNotice | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && Object.hasOwn(LANDING_NOTICES, raw)
    ? (raw as LandingNotice)
    : null;
}

/**
 * Where to send someone who has just logged in. `role` is the account's real role; `intent` is the
 * door they chose (or null when they did not choose one, for example after a verification email).
 */
export function landingFor(role: Role, intent: LoginIntent | null): string {
  const home = homePathForRole(role);
  if (role === "ADMIN") return home;
  const isBuilder = role === "BUILDER_OWNER" || role === "BUILDER_TEAM";

  // A buyer who came through the builder door is offered the chance to create a builder account.
  if (intent === "builder" && !isBuilder) return "/start-listing";
  // A builder who came through the buyer door is told why they are in the portal.
  if (intent === "buyer" && isBuilder) return `${home}?notice=builder-account`;
  return home;
}
