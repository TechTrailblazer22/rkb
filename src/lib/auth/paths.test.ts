import { describe, expect, it } from "vitest";
import { isProtectedPath, safeReturnTo } from "@/lib/auth/paths";

describe("isProtectedPath", () => {
  it.each([
    "/dashboard",
    "/portal",
    "/portal/projects/1",
    "/admin",
    "/account",
    "/welcome",
    "/start-listing",
  ])("protects %s", (path) => expect(isProtectedPath(path)).toBe(true));

  it.each(["/", "/api/health", "/for-builders", "/pricing", "/accounting", "/administrator"])(
    "leaves %s public",
    (path) => expect(isProtectedPath(path)).toBe(false),
  );
});

describe("safeReturnTo", () => {
  it("keeps same-site relative paths, including query strings", () => {
    expect(safeReturnTo("/portal/projects?tab=plots")).toBe("/portal/projects?tab=plots");
  });

  it("falls back when empty or missing", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(null, "/account")).toBe("/account");
    expect(safeReturnTo("")).toBe("/");
  });

  it.each([
    "https://evil.com",
    "http://evil.com/portal",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "portal",
    "/portal\n//evil.com",
    "/\t/evil.com",
  ])("rejects unsafe value %j", (value) => {
    expect(safeReturnTo(value, "/safe")).toBe("/safe");
  });
});
