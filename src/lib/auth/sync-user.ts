import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { computeRole } from "@/lib/auth/roles";
import { canBuild, defaultMode, modesFor, roleForMode, type Mode } from "@/lib/auth/mode";

// No Next.js or `server-only` imports here, so integration tests can run this against
// a real Postgres.

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  /**
   * The role in the mode the person is using right now (BUYER while they use their buyer account,
   * the builder role while they use their builder account). This is what the access checks read.
   */
  role: Role;
  /** What the person can be, as stored: BUYER, a builder role (which also allows buying), or ADMIN. */
  storedRole: Role;
  /** The mode in use, and the modes they may switch between. */
  mode: Mode;
  modes: Mode[];
  /** Whether they have a builder account (a buyer account needs no setup). */
  canBuild: boolean;
  builderIds: string[];
  termsVersion: string | null;
};

export type SyncResult =
  | { status: "ok"; user: AppUser }
  | { status: "no-email" }
  | { status: "email-unverified" }
  | { status: "email-conflict" };

export type Claims = {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
};

const userInclude = { builderMemberships: { select: { builderId: true } } } as const;

type UserWithMemberships = NonNullable<Awaited<ReturnType<PrismaClient["user"]["findUnique"]>>> & {
  builderMemberships: { builderId: string }[];
};

function toAppUser(user: UserWithMemberships): AppUser {
  // The mode starts at the default; the session layer applies the person's chosen mode on top.
  const mode = defaultMode(user.role);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    role: roleForMode(user.role, mode),
    storedRole: user.role,
    mode,
    modes: modesFor(user.role),
    canBuild: canBuild(user.role),
    builderIds: user.builderMemberships.map((m) => m.builderId),
    termsVersion: user.termsVersion,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

/**
 * Maps an Auth0 identity to our User row, creating it on first login.
 *
 * - Unverified emails are refused: roles (admin allowlist) and builder ownership hang off
 *   the email, so it must be proven first.
 * - Auth0 does not merge accounts. If the same email already belongs to a different Auth0
 *   identity (for example Google vs password), we refuse rather than silently linking them.
 * - Writes only when something changed, because every page view calls this.
 */
export async function syncUser(
  db: PrismaClient,
  claims: Claims,
  adminEmails: string[],
): Promise<SyncResult> {
  if (!claims.email) return { status: "no-email" };
  if (!claims.emailVerified) return { status: "email-unverified" };
  const email = claims.email.trim().toLowerCase();

  const existing = await db.user.findUnique({
    where: { auth0Sub: claims.sub },
    include: userInclude,
  });

  if (existing) {
    const role = computeRole({
      current: existing.role,
      email,
      emailVerified: true,
      adminEmails,
    });
    const data: { role?: Role; name?: string } = {};
    if (role !== existing.role) data.role = role;
    if (claims.name && claims.name !== existing.name) data.name = claims.name;
    if (Object.keys(data).length === 0) return { status: "ok", user: toAppUser(existing) };

    const updated = await db.user.update({
      where: { id: existing.id },
      data,
      include: userInclude,
    });
    return { status: "ok", user: toAppUser(updated) };
  }

  const sameEmail = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (sameEmail) return { status: "email-conflict" };

  try {
    const created = await db.user.create({
      data: {
        auth0Sub: claims.sub,
        email,
        name: claims.name ?? null,
        role: computeRole({ current: "BUYER", email, emailVerified: true, adminEmails }),
      },
      include: userInclude,
    });
    return { status: "ok", user: toAppUser(created) };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Two first requests raced (the browser fires several at once). The other one won.
    const winner = await db.user.findUnique({
      where: { auth0Sub: claims.sub },
      include: userInclude,
    });
    return winner ? { status: "ok", user: toAppUser(winner) } : { status: "email-conflict" };
  }
}
