import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_PATHS, PUBLIC_PATHS, getSiteUrl } from "@/lib/site";
import { isProtectedPath } from "@/lib/auth/paths";

describe("getSiteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers APP_BASE_URL, then Render's URL, then localhost", () => {
    vi.stubEnv("APP_BASE_URL", "https://rkb.example.com");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://rkb.onrender.com");
    expect(getSiteUrl().origin).toBe("https://rkb.example.com");

    vi.stubEnv("APP_BASE_URL", "");
    expect(getSiteUrl().origin).toBe("https://rkb.onrender.com");

    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    expect(getSiteUrl().origin).toBe("http://localhost:3000");
  });

  it("falls back safely on a malformed value", () => {
    vi.stubEnv("APP_BASE_URL", "not a url");
    expect(getSiteUrl().origin).toBe("http://localhost:3000");
  });
});

describe("indexable paths", () => {
  it("never lists a page that needs login", () => {
    for (const path of PUBLIC_PATHS) expect(isProtectedPath(path)).toBe(false);
  });

  it("keeps every login-protected area out of search engines", () => {
    for (const path of [
      "/dashboard",
      "/portal",
      "/admin",
      "/account",
      "/welcome",
      "/start-listing",
    ]) {
      expect(isProtectedPath(path)).toBe(true);
      expect(PRIVATE_PATHS).toContain(path);
    }
  });
});
