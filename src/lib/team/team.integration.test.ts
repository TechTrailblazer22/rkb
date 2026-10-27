import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  hashToken,
  listTeam,
  previewInvite,
  removeMember,
  revokeInvite,
} from "@/lib/team/service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const DAY = 86_400_000;

describe.skipIf(!url)("team invitations (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let ownerId: string;

  const plan = (plan: "STARTER" | "GROWTH" | "PREMIER") =>
    db.subscription.upsert({
      where: { builderId },
      create: {
        builderId,
        plan,
        interval: "MONTHLY",
        source: "COMP",
        currentPeriodStart: new Date(NOW.getTime() - DAY),
        currentPeriodEnd: new Date(NOW.getTime() + 29 * DAY),
      },
      update: { plan },
    });
  const person = (email: string, role: "BUYER" | "BUILDER_OWNER" | "ADMIN" = "BUYER") =>
    db.user.create({ data: { auth0Sub: `auth0|${email}`, email, role } });
  const invite = (email: string, role: unknown = "MANAGER", now = NOW) =>
    createInvite(db, { builderId, invitedById: ownerId, email, role, now });

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    const owner = await person("owner@test.example", "BUILDER_OWNER");
    ownerId = owner.id;
    builderId = (
      await db.builder.create({ data: { companyName: "Anand Realty", status: "VERIFIED" } })
    ).id;
    await db.builderMember.create({ data: { builderId, userId: ownerId, role: "OWNER" } });
    await plan("GROWTH"); // 3 seats
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  describe("inviting", () => {
    it("stores only a hash of the link's token", async () => {
      const result = await invite("Sam@Test.Example");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.email).toBe("sam@test.example");
      const row = await db.teamInvite.findFirstOrThrow({ where: { builderId } });
      expect(row.tokenHash).toBe(hashToken(result.token));
      expect(row.tokenHash).not.toContain(result.token);
      expect(row.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
    });

    it("rejects a bad address, an unknown role, and someone already in the team", async () => {
      expect(await invite("not-an-email")).toMatchObject({ ok: false, code: "bad_email" });
      expect(await invite("a@b.example", "OWNER")).toMatchObject({ ok: false, code: "bad_role" });
      expect(await invite("a@b.example", null)).toMatchObject({
        ok: false,
        code: "bad_role",
      });
      expect(await invite("OWNER@test.example")).toMatchObject({
        ok: false,
        code: "already_member",
      });
    });

    it("counts pending invitations against the seats, then refuses", async () => {
      expect((await invite("a@test.example")).ok).toBe(true);
      expect((await invite("b@test.example")).ok).toBe(true); // owner + 2 = 3 seats
      expect(await invite("c@test.example")).toMatchObject({ ok: false, code: "no_seats" });
      // an expired invitation no longer holds a seat
      const later = new Date(NOW.getTime() + 8 * DAY);
      await plan("GROWTH");
      await db.subscription.update({
        where: { builderId },
        data: { currentPeriodEnd: new Date(later.getTime() + DAY) },
      });
      expect((await invite("c@test.example", "STAFF", later)).ok).toBe(true);
    });

    it("never goes over the seats when invitations arrive at once", async () => {
      const results = await Promise.all(
        ["a", "b", "c", "d", "e"].map((n) => invite(`${n}@test.example`)),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(await db.teamInvite.count()).toBe(2);
    });

    it("replaces an earlier invitation to the same address", async () => {
      const first = await invite("a@test.example");
      const second = await invite("a@test.example", "STAFF");
      expect(await db.teamInvite.count()).toBe(1);
      expect(await previewInvite(db, (first as { token: string }).token, NOW)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await previewInvite(db, (second as { token: string }).token, NOW)).toMatchObject({
        ok: true,
        role: "STAFF",
      });
    });

    it("gives a Starter company no room for teammates, and a company with no plan none either", async () => {
      await plan("STARTER");
      expect(await invite("a@test.example")).toMatchObject({ ok: false, code: "no_seats" });
      await db.subscription.delete({ where: { builderId } });
      expect(await invite("a@test.example")).toMatchObject({ ok: false, code: "no_seats" });
    });

    it("lets the owner withdraw an invitation, and only their own company's", async () => {
      await invite("a@test.example");
      const row = await db.teamInvite.findFirstOrThrow();
      const otherBuilder = await db.builder.create({ data: { companyName: "Other" } });
      expect(
        await revokeInvite(db, { builderId: otherBuilder.id, inviteId: row.id, actorId: ownerId }),
      ).toBe(false);
      expect(await revokeInvite(db, { builderId, inviteId: row.id, actorId: ownerId })).toBe(true);
      expect(await db.teamInvite.count()).toBe(0);
    });
  });

  describe("accepting", () => {
    const invited = async (email = "sam@test.example", role: unknown = "MANAGER") => {
      const result = await invite(email, role);
      if (!result.ok) throw new Error(result.message);
      return result.token;
    };
    const accept = (token: string, user: { id: string; email: string; storedRole: string }) =>
      acceptInvite(db, { token, user, now: NOW });

    it("adds the person with the invited role and makes a buyer account a builder-team one too", async () => {
      const token = await invited();
      const sam = await person("sam@test.example");
      const result = await accept(token, { id: sam.id, email: sam.email, storedRole: "BUYER" });
      expect(result).toEqual({ ok: true, builderId, role: "MANAGER" });
      expect(await db.builderMember.findFirstOrThrow({ where: { userId: sam.id } })).toMatchObject({
        builderId,
        role: "MANAGER",
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: sam.id } })).role).toBe(
        "BUILDER_TEAM",
      );
      const team = await listTeam(db, builderId, NOW);
      expect(team.members).toHaveLength(2);
      expect(team.invites).toHaveLength(0);
    });

    it("works exactly once, even when two people click at the same moment", async () => {
      const token = await invited();
      const sam = await person("sam@test.example");
      const user = { id: sam.id, email: sam.email, storedRole: "BUYER" };
      const results = await Promise.all([accept(token, user), accept(token, user)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.builderMember.count({ where: { userId: sam.id } })).toBe(1);
      expect(await accept(token, user)).toMatchObject({ ok: false, code: "used" });
    });

    it("refuses an unknown link, an expired one, and a different email address", async () => {
      expect(
        await accept("nope", { id: "x", email: "x@y.example", storedRole: "BUYER" }),
      ).toMatchObject({ ok: false, code: "not_found" });
      const token = await invited();
      const other = await person("other@test.example");
      const wrong = await accept(token, { id: other.id, email: other.email, storedRole: "BUYER" });
      expect(wrong).toMatchObject({ ok: false, code: "wrong_email" });
      expect(await db.builderMember.count({ where: { userId: other.id } })).toBe(0);

      const sam = await person("sam@test.example");
      const late = await acceptInvite(db, {
        token,
        user: { id: sam.id, email: sam.email, storedRole: "BUYER" },
        now: new Date(NOW.getTime() + 8 * DAY),
      });
      expect(late).toMatchObject({ ok: false, code: "expired" });
    });

    it("matches the address ignoring case", async () => {
      const token = await invited("sam@test.example");
      const sam = await person("sam@test.example");
      expect(
        (await accept(token, { id: sam.id, email: "SAM@Test.Example", storedRole: "BUYER" })).ok,
      ).toBe(true);
    });

    it("refuses staff, and someone who already belongs to a company", async () => {
      const token = await invited();
      const admin = await person("sam@test.example", "ADMIN");
      expect(
        await accept(token, { id: admin.id, email: admin.email, storedRole: "ADMIN" }),
      ).toMatchObject({ ok: false, code: "not_allowed" });
      await db.user.delete({ where: { id: admin.id } });

      const sam = await person("sam@test.example", "BUILDER_OWNER");
      const theirs = await db.builder.create({ data: { companyName: "Sam Builders" } });
      await db.builderMember.create({
        data: { builderId: theirs.id, userId: sam.id, role: "OWNER" },
      });
      expect(
        await accept(token, { id: sam.id, email: sam.email, storedRole: "BUILDER_OWNER" }),
      ).toMatchObject({ ok: false, code: "in_a_company" });
    });

    it("checks the seats again when accepting: a downgrade after inviting blocks the join", async () => {
      const token = await invited();
      await plan("STARTER");
      const sam = await person("sam@test.example");
      expect(
        await accept(token, { id: sam.id, email: sam.email, storedRole: "BUYER" }),
      ).toMatchObject({ ok: false, code: "no_seats" });
      // and the link is not burnt: it works after the company upgrades
      await plan("GROWTH");
      expect((await accept(token, { id: sam.id, email: sam.email, storedRole: "BUYER" })).ok).toBe(
        true,
      );
    });
  });

  describe("managing the team", () => {
    const join = async (email: string) => {
      const result = await invite(email);
      if (!result.ok) throw new Error(result.message);
      const user = await person(email);
      await acceptInvite(db, {
        token: result.token,
        user: { id: user.id, email, storedRole: "BUYER" },
        now: NOW,
      });
      return {
        user,
        member: await db.builderMember.findFirstOrThrow({ where: { userId: user.id } }),
      };
    };

    it("removes a teammate, who becomes a buyer again, but never the owner", async () => {
      const { user, member } = await join("sam@test.example");
      const ownerMember = await db.builderMember.findFirstOrThrow({ where: { userId: ownerId } });
      expect(
        await removeMember(db, { builderId, memberId: ownerMember.id, actorId: ownerId }),
      ).toBe(false);
      expect(await removeMember(db, { builderId, memberId: member.id, actorId: ownerId })).toBe(
        true,
      );
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("BUYER");
      expect(await db.builderMember.count({ where: { builderId } })).toBe(1);
    });

    it("cannot reach into another company", async () => {
      const { member } = await join("sam@test.example");
      const other = await db.builder.create({ data: { companyName: "Other" } });
      expect(
        await removeMember(db, { builderId: other.id, memberId: member.id, actorId: ownerId }),
      ).toBe(false);
      expect(
        await changeMemberRole(db, {
          builderId: other.id,
          memberId: member.id,
          role: "STAFF",
          actorId: ownerId,
        }),
      ).toBe(false);
    });

    it("changes Manager to Staff and back, never the owner, never to Owner", async () => {
      const { member } = await join("sam@test.example");
      const change = (memberId: string, role: unknown) =>
        changeMemberRole(db, { builderId, memberId, role, actorId: ownerId });
      expect(await change(member.id, "STAFF")).toBe(true);
      expect((await db.builderMember.findUniqueOrThrow({ where: { id: member.id } })).role).toBe(
        "STAFF",
      );
      expect(await change(member.id, "OWNER")).toBe(false);
      const ownerMember = await db.builderMember.findFirstOrThrow({ where: { userId: ownerId } });
      expect(await change(ownerMember.id, "STAFF")).toBe(false);
    });

    it("a freed seat can be invited again", async () => {
      const a = await join("a@test.example");
      await join("b@test.example");
      expect(await invite("c@test.example")).toMatchObject({ ok: false, code: "no_seats" });
      await removeMember(db, { builderId, memberId: a.member.id, actorId: ownerId });
      expect((await invite("c@test.example")).ok).toBe(true);
    });
  });
});
