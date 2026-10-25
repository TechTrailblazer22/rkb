import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /login-continue", () => {
  it("redirects to a clean Auth0 login that returns to the dashboard", () => {
    const response = GET(new Request("https://rkb.example.com/login-continue"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://rkb.example.com/auth/login?returnTo=%2Fdashboard",
    );
  });

  it("drops query parameters that Auth0 adds, such as iss", () => {
    const response = GET(
      new Request(
        "https://rkb.example.com/login-continue?iss=https%3A%2F%2Ft.auth0.com%2F&returnTo=https%3A%2F%2Fevil.com&screen_hint=signup",
      ),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://rkb.example.com");
    expect([...location.searchParams.keys()]).toEqual(["returnTo"]);
    expect(location.searchParams.get("returnTo")).toBe("/dashboard");
  });
});
