import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Role } from "@/generated/prisma/enums";
import { getAuth0, isAuthConfigured } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { parseAdminEmails } from "@/lib/auth/roles";
import {
  MODE_COOKIE,
  homePathForMode,
  parseMode,
  resolveMode,
  roleForMode,
  type Mode,
} from "@/lib/auth/mode";
import { syncUser, type AppUser, type SyncResult } from "@/lib/auth/sync-user";
import { TERMS_VERSION } from "@/lib/legal";
import { recordActivity } from "@/lib/usage/activity";

/** Auth0 session, or null when logged out or Auth0 is not configured. No database access. */
export async function getSessionUser() {
  // Per-user data must never be prerendered at build time. Without this, a build with no
  // Auth0 config would bake "not logged in" into the page for everyone.
  await connection();
  if (!isAuthConfigured()) return null;
  const session = await getAuth0().getSession();
  return session?.user ?? null;
}

// cache() de-duplicates within one request: layout, page and actions share one lookup.
const resolveUser = cache(
  async (
    sub: string,
    email: string | undefined,
    emailVerified: boolean | undefined,
    name: string | undefined,
  ): Promise<SyncResult> =>
    syncUser(
      getDb(),
      { sub, email, emailVerified, name },
      parseAdminEmails(process.env.ADMIN_EMAILS),
    ),
);

/** The mode in the visitor's cookie, or null. A preference only: see applyMode. */
async function modeFromCookie(): Promise<Mode | null> {
  try {
    return parseMode((await cookies()).get(MODE_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * Puts the person into the mode they asked for, if they are entitled to it (see resolveMode), and
 * makes `role` the role of that mode. This is the one place the cookie is applied.
 */
function applyMode(user: AppUser, requested: Mode | null): AppUser {
  const mode = resolveMode(user.storedRole, requested);
  return { ...user, mode, role: roleForMode(user.storedRole, mode) };
}

export type SessionAccount = Pick<AppUser, "role" | "mode" | "modes" | "canBuild">;

/**
 * Who is logged in and which of their accounts they are using, for things that only change what is
 * shown (the header, a greeting). Null when logged out, when the email is not verified yet, or if
 * the lookup fails: a broken lookup must never break a page. Access control uses requireUser().
 */
export async function getSessionAccount(): Promise<SessionAccount | null> {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return null;
    const result = await resolveUser(
      sessionUser.sub,
      sessionUser.email,
      sessionUser.email_verified,
      sessionUser.name,
    );
    if (result.status !== "ok") return null;
    const account = applyMode(result.user, await modeFromCookie());
    // This runs when a logged-in person opens any page (the header asks), so it is where "who used
    // the site, through which account" is noted. It never waits and never fails the page.
    void recordActivity(getDb(), { userId: account.id, mode: account.mode });
    const { role, mode, modes, canBuild } = account;
    return { role, mode, modes, canBuild };
  } catch (error) {
    console.error("Could not read the account for the current session", error);
    return null;
  }
}

type RequireUserOptions = {
  /** Where to come back to after login or after accepting the terms. */
  returnTo: string;
  /** Pass false only on the consent page itself. */
  consent?: boolean;
  /** If set, users whose role in the current mode is not listed are sent to the right area. */
  roles?: Role[];
};

/**
 * Use at the top of every private page and server action. The proxy already redirects
 * anonymous visitors, but this is the check that actually protects data.
 */
export async function requireUser(options: RequireUserOptions): Promise<AppUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(options.returnTo)}`);
  }

  const result = await resolveUser(
    sessionUser.sub,
    sessionUser.email,
    sessionUser.email_verified,
    sessionUser.name,
  );
  if (result.status !== "ok") {
    redirect(`/account-problem?reason=${result.status}`);
  }

  const user = applyMode(result.user, await modeFromCookie());
  if (options.consent !== false && user.termsVersion !== TERMS_VERSION) {
    redirect(`/welcome?returnTo=${encodeURIComponent(options.returnTo)}`);
  }
  if (options.roles && !options.roles.includes(user.role)) {
    // A page that belongs to their other account (a link in an email, a bookmark): take them
    // there through the switch, which makes sure they really have that account.
    const other = user.modes.find(
      (mode) => mode !== user.mode && options.roles!.includes(roleForMode(user.storedRole, mode)),
    );
    if (other) redirect(`/switch?to=${other}&next=${encodeURIComponent(options.returnTo)}`);
    redirect(homePathForMode(user.mode));
  }
  void recordActivity(getDb(), { userId: user.id, mode: user.mode });
  return user;
}

export type ApiUserResult =
  | { status: "ok"; user: AppUser }
  | { status: "unauthenticated" | "unverified" | "consent-required" };

/**
 * For route handlers (uploads, downloads). Same checks as requireUser, but it reports the
 * problem instead of redirecting, so the caller can answer 401 or 403 as JSON.
 */
export async function getApiUser(): Promise<ApiUserResult> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { status: "unauthenticated" };

  const result = await resolveUser(
    sessionUser.sub,
    sessionUser.email,
    sessionUser.email_verified,
    sessionUser.name,
  );
  if (result.status !== "ok") return { status: "unverified" };
  if (result.user.termsVersion !== TERMS_VERSION) return { status: "consent-required" };
  return { status: "ok", user: applyMode(result.user, await modeFromCookie()) };
}
