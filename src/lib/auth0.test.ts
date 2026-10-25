import { describe, expect, it } from "vitest";
import { missingAuthEnv } from "@/lib/auth0";

describe("missingAuthEnv", () => {
  it("lists every Auth0 variable when none are set", () => {
    expect(missingAuthEnv({})).toEqual([
      "AUTH0_DOMAIN",
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
      "AUTH0_SECRET",
    ]);
  });

  it("lists only what is missing, treating empty strings as missing", () => {
    expect(
      missingAuthEnv({
        AUTH0_DOMAIN: "t.us.auth0.com",
        AUTH0_CLIENT_ID: "id",
        AUTH0_CLIENT_SECRET: "",
        AUTH0_SECRET: "secret",
      }),
    ).toEqual(["AUTH0_CLIENT_SECRET"]);
  });

  it("returns nothing when fully configured", () => {
    expect(
      missingAuthEnv({
        AUTH0_DOMAIN: "t.us.auth0.com",
        AUTH0_CLIENT_ID: "id",
        AUTH0_CLIENT_SECRET: "s",
        AUTH0_SECRET: "k",
      }),
    ).toEqual([]);
  });
});
