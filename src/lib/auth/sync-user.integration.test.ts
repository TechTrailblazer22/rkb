import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { syncUser } from "@/lib/auth/sync-user";

// Runs against a real, throwaway Postgres with the migrations applied:
//   TEST_DATABASE_URL=postgresql://... npm test
// Skipped when the variable is not set, so a plain `npm test` needs no database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("syncUser (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const admins = ["boss@rkb.com"];

  beforeEach(async () => {
    await db.builderMember.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("creates a BUYER on first verified login and lowercases the email", async () => {
    const result = await syncUser(
      db,
      { sub: "auth0|1", email: "Asha@Example.com", emailVerified: true, name: "Asha" },
      admins,
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.user).toMatchObject({
      email: "asha@example.com",
      name: "Asha",
      role: "BUYER",
      builderIds: [],
      termsVersion: null,
    });
  });

  it("makes a verified allowlisted email an ADMIN", async () => {
    const result = await syncUser(
      db,
      { sub: "auth0|2", email: "boss@rkb.com", emailVerified: true },
      admins,
    );
    expect(result.status === "ok" && result.user.role).toBe("ADMIN");
  });

  it("refuses an unverified email and stores nothing", async () => {
    const result = await syncUser(
      db,
      { sub: "auth0|3", email: "boss@rkb.com", emailVerified: false },
      admins,
    );
    expect(result.status).toBe("email-unverified");
    expect(await db.user.count()).toBe(0);
  });

  it("refuses a login with no email", async () => {
    const result = await syncUser(db, { sub: "auth0|4", emailVerified: true }, admins);
    expect(result.status).toBe("no-email");
  });

  it("does not write on a repeat login with unchanged data", async () => {
    const claims = { sub: "auth0|5", email: "a@example.com", emailVerified: true, name: "A" };
    await syncUser(db, claims, admins);
    const before = await db.user.findUniqueOrThrow({ where: { auth0Sub: "auth0|5" } });
    await syncUser(db, claims, admins);
    const after = await db.user.findUniqueOrThrow({ where: { auth0Sub: "auth0|5" } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("updates the name when it changes at Auth0", async () => {
    const base = { sub: "auth0|6", email: "n@example.com", emailVerified: true };
    await syncUser(db, { ...base, name: "Old" }, admins);
    const result = await syncUser(db, { ...base, name: "New" }, admins);
    expect(result.status === "ok" && result.user.name).toBe("New");
  });

  it("promotes an existing user who is later added to the admin list", async () => {
    const claims = { sub: "auth0|7", email: "later@rkb.com", emailVerified: true };
    const first = await syncUser(db, claims, []);
    expect(first.status === "ok" && first.user.role).toBe("BUYER");
    const second = await syncUser(db, claims, ["later@rkb.com"]);
    expect(second.status === "ok" && second.user.role).toBe("ADMIN");
  });

  it("flags the same email arriving from a different Auth0 identity", async () => {
    await syncUser(
      db,
      { sub: "google-oauth2|1", email: "dup@example.com", emailVerified: true },
      admins,
    );
    const result = await syncUser(
      db,
      { sub: "auth0|9", email: "dup@example.com", emailVerified: true },
      admins,
    );
    expect(result.status).toBe("email-conflict");
    expect(await db.user.count()).toBe(1);
  });

  it("survives simultaneous first requests without duplicates or errors", async () => {
    const claims = { sub: "auth0|10", email: "race@example.com", emailVerified: true };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => syncUser(db, claims, admins)),
    );
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(await db.user.count()).toBe(1);
  });

  it("reports builder memberships and cascades when a builder is deleted", async () => {
    const claims = { sub: "auth0|11", email: "owner@example.com", emailVerified: true };
    const created = await syncUser(db, claims, admins);
    if (created.status !== "ok") throw new Error("setup failed");

    const builder = await db.builder.create({ data: {} });
    await db.builderMember.create({
      data: { builderId: builder.id, userId: created.user.id, role: "OWNER" },
    });

    const again = await syncUser(db, claims, admins);
    expect(again.status === "ok" && again.user.builderIds).toEqual([builder.id]);

    await db.builder.delete({ where: { id: builder.id } });
    expect(await db.builderMember.count()).toBe(0);
  });

  it("rejects the same user being added to one builder twice", async () => {
    const created = await syncUser(
      db,
      { sub: "auth0|12", email: "twice@example.com", emailVerified: true },
      admins,
    );
    if (created.status !== "ok") throw new Error("setup failed");
    const builder = await db.builder.create({ data: {} });
    const data = { builderId: builder.id, userId: created.user.id, role: "OWNER" as const };
    await db.builderMember.create({ data });
    await expect(db.builderMember.create({ data })).rejects.toThrow();
  });
});
