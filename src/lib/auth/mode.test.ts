import { describe, expect, it } from "vitest";
import {
  canBuild,
  defaultMode,
  areaMode,
  homePathForMode,
  isBuilderOnlyPath,
  isBuyerOnlyPath,
  modesFor,
  parseMode,
  redirectForMode,
  resolveMode,
  roleForMode,
  switchTarget,
} from "@/lib/auth/mode";

describe("parseMode", () => {
  it("accepts exactly buyer, builder and admin", () => {
    expect(parseMode("buyer")).toBe("buyer");
    expect(parseMode("builder")).toBe("builder");
    expect(parseMode("admin")).toBe("admin");
    expect(parseMode(["builder", "buyer"])).toBe("builder");
  });

  it.each(["", "BUYER", "owner", "buyer ", "/portal", "__proto__", undefined, null, 1])(
    "ignores anything else: %s",
    (value) => {
      expect(parseMode(value)).toBeNull();
    },
  );
});

describe("what a person may be", () => {
  it.each([
    ["BUYER", ["buyer"], "buyer", false],
    ["BUILDER_OWNER", ["buyer", "builder"], "builder", true],
    ["BUILDER_TEAM", ["buyer", "builder"], "builder", true],
    ["ADMIN", ["admin"], "admin", false],
  ] as const)("%s may use %j, starts in %s", (role, modes, start, builds) => {
    expect(modesFor(role)).toEqual(modes);
    expect(defaultMode(role)).toBe(start);
    expect(canBuild(role)).toBe(builds);
  });
});

describe("resolveMode", () => {
  it("honours a request the person is entitled to", () => {
    expect(resolveMode("BUILDER_OWNER", "buyer")).toBe("buyer");
    expect(resolveMode("BUILDER_OWNER", "builder")).toBe("builder");
    expect(resolveMode("BUYER", "buyer")).toBe("buyer");
  });

  it("never lets a buyer-only person into builder mode, however the cookie is forged", () => {
    expect(resolveMode("BUYER", "builder")).toBe("buyer");
  });

  it("never lets anyone but staff into admin mode", () => {
    expect(resolveMode("BUYER", "admin")).toBe("buyer");
    expect(resolveMode("BUILDER_OWNER", "admin")).toBe("builder");
  });

  it("keeps staff in the console whatever is asked", () => {
    expect(resolveMode("ADMIN", "buyer")).toBe("admin");
    expect(resolveMode("ADMIN", "builder")).toBe("admin");
  });

  it("falls back to the default when nothing sensible was asked", () => {
    expect(resolveMode("BUILDER_OWNER", undefined)).toBe("builder");
    expect(resolveMode("BUYER", "nonsense")).toBe("buyer");
  });
});

describe("roleForMode", () => {
  it("shows a dual person the role of the mode they are in", () => {
    expect(roleForMode("BUILDER_OWNER", "buyer")).toBe("BUYER");
    expect(roleForMode("BUILDER_OWNER", "builder")).toBe("BUILDER_OWNER");
    expect(roleForMode("BUILDER_TEAM", "builder")).toBe("BUILDER_TEAM");
  });

  it("never gives a buyer a builder role", () => {
    expect(roleForMode("BUYER", "builder")).toBe("BUYER");
  });

  it("is always ADMIN for staff", () => {
    expect(roleForMode("ADMIN", "buyer")).toBe("ADMIN");
  });
});

describe("homePathForMode", () => {
  it("has one home per mode", () => {
    expect(homePathForMode("buyer")).toBe("/account");
    expect(homePathForMode("builder")).toBe("/portal");
    expect(homePathForMode("admin")).toBe("/admin");
  });
});

describe("switchTarget", () => {
  it("offers a buyer with a builder account the switch", () => {
    expect(switchTarget("buyer", true)).toEqual({
      to: "builder",
      label: "Switch to builder account",
    });
  });

  it("offers a buyer without one the chance to create it", () => {
    expect(switchTarget("buyer", false)).toEqual({
      to: "builder",
      label: "Create a builder account",
    });
  });

  it("offers a builder the way back to the buyer account", () => {
    expect(switchTarget("builder", true)).toEqual({
      to: "buyer",
      label: "Switch to buyer account",
    });
  });

  it("offers staff nothing", () => {
    expect(switchTarget("admin", false)).toBeNull();
  });
});

describe("which pages belong to which side", () => {
  it.each([
    "/",
    "/projects",
    "/projects/hosur",
    "/projects/hosur/plots",
    "/project/green-valley",
    "/builder/anand",
  ])("%s is a buyer page", (path) => {
    expect(isBuyerOnlyPath(path)).toBe(true);
    expect(isBuilderOnlyPath(path)).toBe(false);
  });

  it.each(["/for-builders", "/pricing"])("%s is a builder page", (path) => {
    expect(isBuilderOnlyPath(path)).toBe(true);
    expect(isBuyerOnlyPath(path)).toBe(false);
  });

  it.each([
    "/login",
    "/terms",
    "/privacy",
    "/disclaimer",
    "/portal",
    "/account",
    "/admin",
    "/projectsX",
    "/builders",
  ])("%s belongs to neither side", (path) => {
    expect(isBuyerOnlyPath(path)).toBe(false);
    expect(isBuilderOnlyPath(path)).toBe(false);
  });
});

describe("areaMode", () => {
  it("knows which account each logged-in area belongs to", () => {
    expect(areaMode("/portal")).toBe("builder");
    expect(areaMode("/portal/projects/abc/plots")).toBe("builder");
    expect(areaMode("/account")).toBe("buyer");
    expect(areaMode("/account/shortlist")).toBe("buyer");
  });

  it.each(["/", "/admin", "/portalx", "/accounts", "/projects", "/switch", "/start-listing"])(
    "%s belongs to neither",
    (path) => {
      expect(areaMode(path)).toBeNull();
    },
  );
});

describe("redirectForMode", () => {
  it("sends a builder away from buyer pages, to the portal", () => {
    expect(redirectForMode("builder", "/")).toBe("/portal");
    expect(redirectForMode("builder", "/projects/hosur")).toBe("/portal");
    expect(redirectForMode("builder", "/project/x")).toBe("/portal");
  });

  it("sends a buyer away from builder pages, to the home page", () => {
    expect(redirectForMode("buyer", "/for-builders")).toBe("/");
    expect(redirectForMode("buyer", "/pricing")).toBe("/");
  });

  it("leaves each side's own pages and the shared pages alone", () => {
    expect(redirectForMode("buyer", "/projects")).toBeNull();
    expect(redirectForMode("builder", "/pricing")).toBeNull();
    expect(redirectForMode("builder", "/terms")).toBeNull();
    expect(redirectForMode("buyer", "/login")).toBeNull();
    expect(redirectForMode("admin", "/projects")).toBeNull();
    expect(redirectForMode("admin", "/pricing")).toBeNull();
  });
});
