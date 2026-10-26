import { describe, expect, it } from "vitest";
import { landingFor, loginHref, parseIntent, parseNotice } from "@/lib/auth/intent";

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

describe("landingFor", () => {
  it.each([
    ["BUYER", "buyer", "/account"],
    ["BUYER", "builder", "/start-listing"],
    ["BUYER", null, "/account"],
    ["BUILDER_OWNER", "builder", "/portal"],
    ["BUILDER_OWNER", "buyer", "/portal?notice=builder-account"],
    ["BUILDER_OWNER", null, "/portal"],
    ["BUILDER_TEAM", "builder", "/portal"],
    ["BUILDER_TEAM", "buyer", "/portal?notice=builder-account"],
    ["ADMIN", "buyer", "/admin"],
    ["ADMIN", "builder", "/admin"],
    ["ADMIN", null, "/admin"],
  ] as const)("%s through the %s door goes to %s", (role, intent, expected) => {
    expect(landingFor(role, intent)).toBe(expected);
  });
});

describe("parseNotice", () => {
  it("knows only the notices we wrote", () => {
    expect(parseNotice("builder-account")).toBe("builder-account");
    expect(parseNotice("<script>")).toBeNull();
    expect(parseNotice("constructor")).toBeNull();
    expect(parseNotice(undefined)).toBeNull();
  });
});
