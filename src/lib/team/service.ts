import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type { BuilderMemberRole } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { entitlementsForBuilder } from "@/lib/entitlements";

// A company's team: the owner invites people by email, each invitation is a single-use link that
// works for 7 days and only for the invited address. Seats come from the plan (see entitlements).
// Everything that changes membership happens in a transaction that first locks the company's row,
// so two invitations or acceptances at once can never go over the seat limit.

export const INVITE_DAYS = 7;
export const INVITABLE_ROLES = ["MANAGER", "STAFF"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const DAY = 86_400_000;

export const roleLabel: Record<BuilderMemberRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  STAFF: "Staff",
};

export function parseInvitableRole(value: unknown): InvitableRole | null {
  return INVITABLE_ROLES.find((role) => role === value) ?? null;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Tx = Prisma.TransactionClient;

async function lockBuilder(tx: Tx, builderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Builder" WHERE "id" = ${builderId} FOR UPDATE`;
}

export type TeamMember = {
  id: string;
  userId: string;
  role: BuilderMemberRole;
  name: string | null;
  email: string;
  joinedAt: Date;
};
export type PendingInvite = {
  id: string;
  email: string;
  role: BuilderMemberRole;
  expiresAt: Date;
  createdAt: Date;
};

export async function listTeam(
  db: PrismaClient,
  builderId: string,
  now: Date = new Date(),
): Promise<{ members: TeamMember[]; invites: PendingInvite[] }> {
  const [members, invites] = await Promise.all([
    db.builderMember.findMany({
      where: { builderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.teamInvite.findMany({
      where: { builderId, acceptedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      name: m.user.name,
      email: m.user.email,
      joinedAt: m.createdAt,
    })),
    invites,
  };
}

export type InviteResult =
  | { ok: true; token: string; email: string; role: InvitableRole; expiresAt: Date }
  | {
      ok: false;
      code: "bad_email" | "bad_role" | "already_member" | "no_seats";
      message: string;
    };

/**
 * Creates an invitation and returns its link token (shown once; only its hash is stored). A second
 * invitation to the same address replaces the first. Pending invitations hold a seat, so an owner
 * cannot invite more people than the plan has room for.
 */
export async function createInvite(
  db: PrismaClient,
  input: {
    builderId: string;
    invitedById: string;
    email: string;
    role: unknown;
    now?: Date;
  },
): Promise<InviteResult> {
  const now = input.now ?? new Date();
  const email = normaliseEmail(input.email);
  const role = parseInvitableRole(input.role);
  if (!isPlausibleEmail(email)) {
    return { ok: false, code: "bad_email", message: "Enter a valid email address." };
  }
  if (!role) return { ok: false, code: "bad_role", message: "Choose Manager or Staff." };
  const { teamSeats } = await entitlementsForBuilder(db, input.builderId, now);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * DAY);

  return db.$transaction(async (tx): Promise<InviteResult> => {
    await lockBuilder(tx, input.builderId);
    const memberAlready = await tx.builderMember.findFirst({
      where: { builderId: input.builderId, user: { email } },
      select: { id: true },
    });
    if (memberAlready) {
      return {
        ok: false,
        code: "already_member",
        message: "That person is already in your team.",
      };
    }
    // Replace an earlier invitation to the same address, so there is only ever one live link.
    await tx.teamInvite.deleteMany({
      where: { builderId: input.builderId, email, acceptedAt: null },
    });
    const [members, pending] = await Promise.all([
      tx.builderMember.count({ where: { builderId: input.builderId } }),
      tx.teamInvite.count({
        where: { builderId: input.builderId, acceptedAt: null, expiresAt: { gt: now } },
      }),
    ]);
    if (members + pending >= teamSeats) {
      return {
        ok: false,
        code: "no_seats",
        message:
          teamSeats === 1
            ? "Your plan has one seat, which is yours. Upgrade to add teammates."
            : `Your plan has ${teamSeats} seats and all of them are used or reserved by invitations.`,
      };
    }
    await tx.teamInvite.create({
      data: {
        builderId: input.builderId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedById: input.invitedById,
        expiresAt,
      },
    });
    await recordAudit(tx, {
      actorId: input.invitedById,
      action: "team.invited",
      entity: "Builder",
      entityId: input.builderId,
      meta: { email, role },
    });
    return { ok: true, token, email, role, expiresAt };
  });
}

export async function revokeInvite(
  db: PrismaClient,
  input: { builderId: string; inviteId: string; actorId: string },
): Promise<boolean> {
  const removed = await db.teamInvite.deleteMany({
    where: { id: input.inviteId, builderId: input.builderId, acceptedAt: null },
  });
  if (removed.count !== 1) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team.invite_revoked",
    entity: "Builder",
    entityId: input.builderId,
    meta: { inviteId: input.inviteId },
  });
  return true;
}

/** What the join page shows before anyone accepts. Never reveals more than the company's name. */
export type InvitePreview =
  | { ok: true; companyName: string | null; email: string; role: BuilderMemberRole }
  | { ok: false; code: "not_found" | "used" | "expired" };

export async function previewInvite(
  db: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<InvitePreview> {
  const invite = await db.teamInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      builder: { select: { companyName: true } },
    },
  });
  if (!invite) return { ok: false, code: "not_found" };
  if (invite.acceptedAt) return { ok: false, code: "used" };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "expired" };
  return {
    ok: true,
    companyName: invite.builder.companyName,
    email: invite.email,
    role: invite.role,
  };
}

export type AcceptResult =
  | { ok: true; builderId: string; role: BuilderMemberRole }
  | {
      ok: false;
      code:
        | "not_found"
        | "used"
        | "expired"
        | "wrong_email"
        | "not_allowed"
        | "in_a_company"
        | "no_seats";
      message: string;
    };

/**
 * Adds the signed-in person to the company that invited them. Checked here, not on the page: the
 * link is unused and unexpired, it was sent to this very address, the person is not staff and is
 * not already in a company, and the plan still has a seat. The invitation is claimed in the same
 * transaction that adds the member, so a link works exactly once.
 */
export async function acceptInvite(
  db: PrismaClient,
  input: {
    token: string;
    user: { id: string; email: string; storedRole: string };
    now?: Date;
  },
): Promise<AcceptResult> {
  const now = input.now ?? new Date();
  const invite = await db.teamInvite.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      id: true,
      builderId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });
  if (!invite) {
    return { ok: false, code: "not_found", message: "This invitation link is not valid." };
  }
  if (invite.acceptedAt) {
    return { ok: false, code: "used", message: "This invitation has already been used." };
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "expired",
      message: "This invitation has expired. Ask the owner to send a new one.",
    };
  }
  if (normaliseEmail(input.user.email) !== invite.email) {
    return {
      ok: false,
      code: "wrong_email",
      message: `This invitation was sent to ${invite.email}. Log in with that email address to accept it.`,
    };
  }
  if (input.user.storedRole === "ADMIN") {
    return {
      ok: false,
      code: "not_allowed",
      message: "Staff accounts cannot join a company's team.",
    };
  }
  const { teamSeats } = await entitlementsForBuilder(db, invite.builderId, now);

  return db.$transaction(async (tx): Promise<AcceptResult> => {
    await lockBuilder(tx, invite.builderId);
    const existing = await tx.builderMember.findFirst({
      where: { userId: input.user.id },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        code: "in_a_company",
        message: "Your account already belongs to a company, and an account can belong to one.",
      };
    }
    const members = await tx.builderMember.count({ where: { builderId: invite.builderId } });
    if (members >= teamSeats) {
      return {
        ok: false,
        code: "no_seats",
        message: "The company has no free seat at the moment. Ask the owner to make room.",
      };
    }
    const claimed = await tx.teamInvite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      return { ok: false, code: "used", message: "This invitation has already been used." };
    }
    await tx.builderMember.create({
      data: { builderId: invite.builderId, userId: input.user.id, role: invite.role },
    });
    // The stored role records that this email now also has a builder account. Their buyer account
    // is untouched.
    if (input.user.storedRole === "BUYER") {
      await tx.user.update({ where: { id: input.user.id }, data: { role: "BUILDER_TEAM" } });
    }
    await recordAudit(tx, {
      actorId: input.user.id,
      action: "team.joined",
      entity: "Builder",
      entityId: invite.builderId,
      meta: { role: invite.role },
    });
    return { ok: true, builderId: invite.builderId, role: invite.role };
  });
}

/** Takes a teammate out of the company. The owner cannot be removed. */
export async function removeMember(
  db: PrismaClient,
  input: { builderId: string; memberId: string; actorId: string },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockBuilder(tx, input.builderId);
    const member = await tx.builderMember.findFirst({
      where: { id: input.memberId, builderId: input.builderId },
      select: { id: true, userId: true, role: true, user: { select: { role: true } } },
    });
    if (!member || member.role === "OWNER") return false;
    await tx.builderMember.delete({ where: { id: member.id } });
    // With no company left they are a buyer again.
    if (member.user.role === "BUILDER_TEAM") {
      await tx.user.update({ where: { id: member.userId }, data: { role: "BUYER" } });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "team.removed",
      entity: "Builder",
      entityId: input.builderId,
      meta: { userId: member.userId },
    });
    return true;
  });
}

/** Switches a teammate between Manager and Staff. The owner's role never changes. */
export async function changeMemberRole(
  db: PrismaClient,
  input: { builderId: string; memberId: string; role: unknown; actorId: string },
): Promise<boolean> {
  const role = parseInvitableRole(input.role);
  if (!role) return false;
  const changed = await db.builderMember.updateMany({
    where: { id: input.memberId, builderId: input.builderId, role: { not: "OWNER" } },
    data: { role },
  });
  if (changed.count !== 1) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team.role_changed",
    entity: "Builder",
    entityId: input.builderId,
    meta: { memberId: input.memberId, role },
  });
  return true;
}
