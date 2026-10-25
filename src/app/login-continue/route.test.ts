import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /login-continue", () => {
  it("redirects to a clean Auth0 login that returns to the dashboard", () => {
    const response = GET();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/auth/login?returnTo=%2Fdashboard");
  });

  it("never names a host, so it is correct behind Render's proxy", () => {
    const location = GET().headers.get("location") ?? "";
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toMatch(/localhost|https?:/);
  });
});
