import { describe, expect, it } from "vitest";
import {
  can,
  computeRole,
  homePathForRole,
  isAdminEmail,
  parseAdminEmails,
  type AuthUser,
} from "@/lib/auth/roles";

const buyer: AuthUser = { id: "u1", role: "BUYER", builderIds: [] };
const owner: AuthUser = { id: "u2", role: "BUILDER_OWNER", builderIds: ["b1"] };
const team: AuthUser = { id: "u3", role: "BUILDER_TEAM", builderIds: ["b1"] };
const admin: AuthUser = { id: "u4", role: "ADMIN", builderIds: [] };

describe("admin email allowlist", () => {
  it("parses a comma separated list, trimming and lowercasing", () => {
    expect(parseAdminEmails(" A@x.com, b@y.com ,,")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("returns an empty list when unset", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(isAdminEmail("Boss@RKB.com", ["boss@rkb.com"])).toBe(true);
    expect(isAdminEmail("other@rkb.com", ["boss@rkb.com"])).toBe(false);
  });
});

describe("computeRole", () => {
  const adminEmails = ["boss@rkb.com"];

  it("promotes a verified allowlisted email to ADMIN", () => {
    expect(
      computeRole({ current: "BUYER", email: "boss@rkb.com", emailVerified: true, adminEmails }),
    ).toBe("ADMIN");
  });

  it("never promotes an unverified email, even if allowlisted", () => {
    expect(
      computeRole({ current: "BUYER", email: "boss@rkb.com", emailVerified: false, adminEmails }),
    ).toBe("BUYER");
  });

  it("does not promote emails outside the allowlist", () => {
    expect(
      computeRole({ current: "BUYER", email: "x@y.com", emailVerified: true, adminEmails }),
    ).toBe("BUYER");
  });

  it("keeps existing roles and never demotes an admin", () => {
    expect(
      computeRole({ current: "BUILDER_OWNER", email: "x@y.com", emailVerified: true, adminEmails }),
    ).toBe("BUILDER_OWNER");
    expect(
      computeRole({ current: "ADMIN", email: "x@y.com", emailVerified: true, adminEmails }),
    ).toBe("ADMIN");
  });
});

describe("homePathForRole", () => {
  it("sends each role to its own area", () => {
    expect(homePathForRole("BUYER")).toBe("/account");
    expect(homePathForRole("BUILDER_OWNER")).toBe("/portal");
    expect(homePathForRole("BUILDER_TEAM")).toBe("/portal");
    expect(homePathForRole("ADMIN")).toBe("/admin");
  });
});

describe("can", () => {
  it("denies everything to anonymous visitors", () => {
    expect(can(null, "account:access")).toBe(false);
    expect(can(null, "admin:access")).toBe(false);
  });

  it("lets any signed-in user into the account area", () => {
    for (const user of [buyer, owner, team, admin]) {
      expect(can(user, "account:access")).toBe(true);
    }
  });

  it("limits the admin area to admins", () => {
    expect(can(admin, "admin:access")).toBe(true);
    for (const user of [buyer, owner, team]) {
      expect(can(user, "admin:access")).toBe(false);
    }
  });

  it("limits the builder portal to builder roles", () => {
    expect(can(owner, "portal:access")).toBe(true);
    expect(can(team, "portal:access")).toBe(true);
    expect(can(buyer, "portal:access")).toBe(false);
    expect(can(admin, "portal:access")).toBe(false);
  });

  it("only lets members manage their own builder", () => {
    expect(can(owner, "builder:manage", { builderId: "b1" })).toBe(true);
    expect(can(team, "builder:manage", { builderId: "b1" })).toBe(true);
    expect(can(owner, "builder:manage", { builderId: "b2" })).toBe(false);
    expect(can(owner, "builder:manage")).toBe(false);
    expect(can(buyer, "builder:manage", { builderId: "b1" })).toBe(false);
  });

  it("lets admins manage any builder", () => {
    expect(can(admin, "builder:manage", { builderId: "anything" })).toBe(true);
  });
});
