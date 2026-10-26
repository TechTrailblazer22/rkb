import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { landingAfterConsent, switchLanding } from "@/lib/auth/landing";
import { defaultMode, modesFor, roleForMode, canBuild, type Mode } from "@/lib/auth/mode";
import type { AppUser } from "@/lib/auth/sync-user";

function person(storedRole: Role, mode: Mode = defaultMode(storedRole)): AppUser {
  return {
    id: "u1",
    email: "a@b.example",
    name: null,
    mobile: null,
    role: roleForMode(storedRole, mode),
    storedRole,
    mode,
    modes: modesFor(storedRole),
    canBuild: canBuild(storedRole),
    builderIds: [],
    termsVersion: null,
  };
}

describe("switchLanding", () => {
  it("moves someone with both accounts to the one they ask for", () => {
    expect(
      switchLanding(person("BUILDER_OWNER", "buyer"), {
        to: "builder",
        next: null,
        fromLink: false,
      }),
    ).toEqual({
      path: "/portal",
      mode: "builder",
    });
    expect(
      switchLanding(person("BUILDER_OWNER", "builder"), {
        to: "buyer",
        next: null,
        fromLink: false,
      }),
    ).toEqual({
      path: "/account",
      mode: "buyer",
    });
  });

  it("takes them to the page they wanted when it is on this site", () => {
    expect(
      switchLanding(person("BUILDER_OWNER", "buyer"), {
        to: "builder",
        next: "/portal/projects/x",
        fromLink: true,
      }),
    ).toEqual({ path: "/portal/projects/x", mode: "builder" });
  });

  it("never leaves the site", () => {
    expect(
      switchLanding(person("BUILDER_OWNER", "buyer"), {
        to: "builder",
        next: "https://evil.example",
        fromLink: true,
      }).path,
    ).toBe("/portal");
    expect(
      switchLanding(person("BUILDER_OWNER", "buyer"), {
        to: "builder",
        next: "//evil.example",
        fromLink: true,
      }).path,
    ).toBe("/portal");
  });

  it("offers a buyer without a builder account the page that creates one", () => {
    expect(switchLanding(person("BUYER"), { to: "builder", next: null, fromLink: false })).toEqual({
      path: "/start-listing",
      mode: null,
    });
  });

  it("but just sends them home when they only opened a builder address", () => {
    expect(
      switchLanding(person("BUYER"), { to: "builder", next: "/portal", fromLink: true }),
    ).toEqual({
      path: "/account",
      mode: null,
    });
  });

  it("never switches anyone into admin, or staff out of it", () => {
    expect(
      switchLanding(person("BUILDER_OWNER", "builder"), {
        to: "admin",
        next: null,
        fromLink: false,
      }),
    ).toEqual({
      path: "/portal",
      mode: null,
    });
    expect(switchLanding(person("ADMIN"), { to: "builder", next: null, fromLink: false })).toEqual({
      path: "/admin",
      mode: null,
    });
    expect(
      switchLanding(person("ADMIN"), { to: "buyer", next: null, fromLink: false }).mode,
    ).toBeNull();
  });

  it("ignores a junk target", () => {
    expect(switchLanding(person("BUYER"), { to: "<script>", next: null, fromLink: false })).toEqual(
      {
        path: "/account",
        mode: null,
      },
    );
  });
});

describe("landingAfterConsent", () => {
  it("applies /dashboard?as=… itself", () => {
    expect(landingAfterConsent(person("BUYER"), "/dashboard?as=buyer")).toEqual({
      path: "/account",
      mode: "buyer",
    });
    expect(landingAfterConsent(person("BUYER"), "/dashboard?as=builder")).toEqual({
      path: "/start-listing",
      mode: "buyer",
    });
    expect(landingAfterConsent(person("BUILDER_OWNER", "buyer"), "/dashboard?as=builder")).toEqual({
      path: "/portal",
      mode: "builder",
    });
  });

  it("applies /switch itself", () => {
    expect(
      landingAfterConsent(
        person("BUILDER_OWNER", "buyer"),
        "/switch?to=builder&link=1&next=%2Fportal%2Fprojects",
      ),
    ).toEqual({
      path: "/portal/projects",
      mode: "builder",
    });
  });

  it("leaves every other destination alone", () => {
    expect(landingAfterConsent(person("BUYER"), "/account/shortlist")).toEqual({
      path: "/account/shortlist",
      mode: null,
    });
    expect(landingAfterConsent(person("BUYER"), "/projects?q=hosur")).toEqual({
      path: "/projects?q=hosur",
      mode: null,
    });
  });
});
