import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Role } from "@/generated/prisma/enums";
import { getAuth0, isAuthConfigured } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { parseAdminEmails, homePathForRole } from "@/lib/auth/roles";
import { syncUser, type AppUser, type SyncResult } from "@/lib/auth/sync-user";
import { TERMS_VERSION } from "@/lib/legal";

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

type RequireUserOptions = {
  /** Where to come back to after login or after accepting the terms. */
  returnTo: string;
  /** Pass false only on the consent page itself. */
  consent?: boolean;
  /** If set, users with any other role are sent to their own area. */
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

  const { user } = result;
  if (options.consent !== false && user.termsVersion !== TERMS_VERSION) {
    redirect(`/welcome?returnTo=${encodeURIComponent(options.returnTo)}`);
  }
  if (options.roles && !options.roles.includes(user.role)) {
    redirect(homePathForRole(user.role));
  }
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
  return { status: "ok", user: result.user };
}
