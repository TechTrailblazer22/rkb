import { describe, expect, it } from "vitest";
import { absoluteRedirect, publicOrigin, redirectTo } from "@/lib/http";

// What Render's proxy makes the server believe its address is.
const internal = { nextUrl: { origin: "https://localhost:10000" } };

describe("redirectTo (route handlers)", () => {
  it("sends a relative Location, never a host", () => {
    const response = redirectTo("/auth/login?returnTo=%2Fportal");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/auth/login?returnTo=%2Fportal");
  });

  it("allows a different status", () => {
    expect(redirectTo("/pricing", 308).status).toBe(308);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "portal", ""])(
    "refuses %j, so a redirect can never leave the site",
    (target) => {
      expect(() => redirectTo(target)).toThrow();
    },
  );
});

describe("publicOrigin", () => {
  it("prefers APP_BASE_URL over everything", () => {
    expect(
      publicOrigin(internal, {
        APP_BASE_URL: "https://rkb.example.com/some/path",
        RENDER_EXTERNAL_URL: "https://rkb.onrender.com",
      }),
    ).toBe("https://rkb.example.com");
  });

  it("uses Render's own URL when APP_BASE_URL is not set", () => {
    expect(publicOrigin(internal, { RENDER_EXTERNAL_URL: "https://rkb.onrender.com" })).toBe(
      "https://rkb.onrender.com",
    );
    expect(
      publicOrigin(internal, { APP_BASE_URL: "", RENDER_EXTERNAL_URL: "https://rkb.onrender.com" }),
    ).toBe("https://rkb.onrender.com");
  });

  it("falls back to the request origin in local development", () => {
    expect(publicOrigin({ nextUrl: { origin: "http://localhost:3114" } }, {})).toBe(
      "http://localhost:3114",
    );
  });

  it("skips a malformed setting instead of failing", () => {
    expect(
      publicOrigin(internal, {
        APP_BASE_URL: "not a url",
        RENDER_EXTERNAL_URL: "https://rkb.onrender.com",
      }),
    ).toBe("https://rkb.onrender.com");
  });
});

describe("absoluteRedirect (proxy)", () => {
  it("points at the public address, not Render's internal one", () => {
    const response = absoluteRedirect(internal, "/auth/login?returnTo=%2Fportal", {
      RENDER_EXTERNAL_URL: "https://rkb-platform.onrender.com",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://rkb-platform.onrender.com/auth/login?returnTo=%2Fportal",
    );
    expect(response.headers.get("location")).not.toContain("localhost");
  });

  it("refuses targets outside this site", () => {
    expect(() => absoluteRedirect(internal, "https://evil.example", {})).toThrow();
    expect(() => absoluteRedirect(internal, "//evil.example", {})).toThrow();
  });
});
