import type { Role } from "@/generated/prisma/enums";

// The "mode" is which of a person's accounts they are using right now: the buyer account, the
// builder account, or (for staff) the admin console. One email can have both a buyer and a builder
// account, and switch between them without logging out. See docs/LOGIN-ROLES.md.
//
// The mode is a *preference*, remembered in a cookie. It never grants anything: whether someone
// has a builder account comes from the database (their stored role), and every function here that
// accepts a requested mode checks it against that.

export type Mode = "buyer" | "builder" | "admin";

export const MODE_COOKIE = "rkb_mode";
/** Long enough to survive the login session, so a person returns to the mode they were in. */
export const MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

const MODES: readonly Mode[] = ["buyer", "builder", "admin"];

/** The mode in a cookie or address, or null for anything that is not exactly one of the three. */
export function parseMode(value: unknown): Mode | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return MODES.find((mode) => mode === raw) ?? null;
}

const isBuilderRole = (role: Role) => role === "BUILDER_OWNER" || role === "BUILDER_TEAM";

/** Whether this person has a builder account (as opposed to only a buyer one). */
export function canBuild(storedRole: Role): boolean {
  return isBuilderRole(storedRole);
}

/** The modes this person may use. A buyer account needs no setup, so everyone but staff has it. */
export function modesFor(storedRole: Role): Mode[] {
  if (storedRole === "ADMIN") return ["admin"];
  return isBuilderRole(storedRole) ? ["buyer", "builder"] : ["buyer"];
}

/** The mode used when none has been chosen yet: builders keep landing in their portal. */
export function defaultMode(storedRole: Role): Mode {
  if (storedRole === "ADMIN") return "admin";
  return isBuilderRole(storedRole) ? "builder" : "buyer";
}

/** The requested mode if the person may use it, otherwise their default. */
export function resolveMode(storedRole: Role, requested: unknown): Mode {
  const mode = parseMode(requested);
  return mode && modesFor(storedRole).includes(mode) ? mode : defaultMode(storedRole);
}

/** The role the rest of the code sees while the person is in this mode. */
export function roleForMode(storedRole: Role, mode: Mode): Role {
  if (storedRole === "ADMIN") return "ADMIN";
  if (mode === "builder" && isBuilderRole(storedRole)) return storedRole;
  return "BUYER";
}

export function homePathForMode(mode: Mode): string {
  switch (mode) {
    case "admin":
      return "/admin";
    case "builder":
      return "/portal";
    default:
      return "/account";
  }
}

/** The button that moves someone to their other account, or null when there is no other. */
export function switchTarget(
  mode: Mode,
  hasBuilderAccount: boolean,
): { to: "buyer" | "builder"; label: string } | null {
  if (mode === "admin") return null;
  if (mode === "builder") return { to: "buyer", label: "Switch to buyer account" };
  return {
    to: "builder",
    label: hasBuilderAccount ? "Switch to builder account" : "Create a builder account",
  };
}

// ---------- which areas and pages belong to which side ----------

/** The account a logged-in area belongs to: the builder portal or the buyer account. */
export function areaMode(pathname: string): "buyer" | "builder" | null {
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "builder";
  if (pathname === "/account" || pathname.startsWith("/account/")) return "buyer";
  return null;
}

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Pages made for buyers: the home page, search, project pages and public builder pages. */
export function isBuyerOnlyPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    under(pathname, "/projects") ||
    under(pathname, "/project") ||
    under(pathname, "/builder")
  );
}

/** Pages made for builders: the marketing pages that sell the platform to them. */
export function isBuilderOnlyPath(pathname: string): boolean {
  return under(pathname, "/for-builders") || under(pathname, "/pricing");
}

/**
 * Where a logged-in visitor in this mode should be sent instead of the page they asked for, or
 * null when the page is fine for them. Used by the proxy, so the page itself stays cacheable.
 */
export function redirectForMode(mode: Mode, pathname: string): string | null {
  if (mode === "builder" && isBuyerOnlyPath(pathname)) return "/portal";
  if (mode === "buyer" && isBuilderOnlyPath(pathname)) return "/";
  return null;
}
