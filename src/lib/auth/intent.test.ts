import { describe, expect, it } from "vitest";
import { loginHref, parseIntent, resolveLogin } from "@/lib/auth/intent";

describe("parseIntent", () => {
  it("accepts exactly buyer and builder", () => {
    expect(parseIntent("buyer")).toBe("buyer");
    expect(parseIntent("builder")).toBe("builder");
  });

  it("takes the first of repeated values", () => {
    expect(parseIntent(["builder", "buyer"])).toBe("builder");
  });

  it.each(["", "admin", "BUYER", "buyer ", "/portal", "https://evil.example", undefined, null, 5])(
    "ignores anything else: %s",
    (value) => {
      expect(parseIntent(value)).toBeNull();
    },
  );
});

describe("loginHref", () => {
  it("sends the person back through /dashboard with their door", () => {
    expect(loginHref("buyer")).toBe("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuyer");
    expect(loginHref("builder")).toBe("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuilder");
  });

  it("asks Auth0 for its sign-up screen when creating an account", () => {
    expect(loginHref("buyer", { signup: true })).toBe(
      "/auth/login?screen_hint=signup&returnTo=%2Fdashboard%3Fas%3Dbuyer",
    );
  });
});

describe("resolveLogin", () => {
  it.each([
    // [stored role, door, mode they were in, expected mode, expected path]
    ["BUYER", "buyer", null, "buyer", "/account"],
    ["BUYER", "builder", null, "buyer", "/start-listing"],
    ["BUYER", null, null, "buyer", "/account"],
    ["BUILDER_OWNER", "builder", "buyer", "builder", "/portal"],
    ["BUILDER_OWNER", "buyer", "builder", "buyer", "/account"],
    ["BUILDER_OWNER", null, "buyer", "buyer", "/account"],
    ["BUILDER_OWNER", null, "builder", "builder", "/portal"],
    ["BUILDER_OWNER", null, null, "builder", "/portal"],
    ["BUILDER_TEAM", "buyer", null, "buyer", "/account"],
    ["BUILDER_TEAM", "builder", null, "builder", "/portal"],
    ["ADMIN", "buyer", null, "admin", "/admin"],
    ["ADMIN", "builder", null, "admin", "/admin"],
    ["ADMIN", null, "buyer", "admin", "/admin"],
  ] as const)(
    "%s through the %s door (was in %s) goes to %s mode at %s",
    (role, intent, was, mode, path) => {
      expect(resolveLogin({ storedRole: role, intent, currentMode: was })).toEqual({ mode, path });
    },
  );

  it("ignores a remembered mode the person is not entitled to", () => {
    expect(resolveLogin({ storedRole: "BUYER", intent: null, currentMode: "builder" })).toEqual({
      mode: "buyer",
      path: "/account",
    });
  });
});

describe("loginHref with a page to come back to", () => {
  it("passes the page along, encoded", () => {
    expect(loginHref("buyer", { next: "/project/green-valley?enquire=1" })).toBe(
      "/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuyer%26next%3D%252Fproject%252Fgreen-valley%253Fenquire%253D1",
    );
  });
});
