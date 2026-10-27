import { describe, expect, it } from "vitest";
import { checkCronAccess } from "@/lib/cron/auth";

const SECRET = "a-long-random-secret-for-the-scheduler";
const headers = (authorization?: string) => ({
  get: (name: string) => (name.toLowerCase() === "authorization" ? (authorization ?? null) : null),
});

describe("checkCronAccess", () => {
  it("lets the scheduler in with the right secret", () => {
    expect(checkCronAccess(headers(`Bearer ${SECRET}`), SECRET)).toBe("ok");
  });

  it("switches the jobs off entirely when no secret is configured", () => {
    expect(checkCronAccess(headers(`Bearer ${SECRET}`), undefined)).toBe("disabled");
    expect(checkCronAccess(headers(`Bearer ${SECRET}`), "")).toBe("disabled");
  });

  it("will not accept a weak secret, because it would be guessable", () => {
    expect(checkCronAccess(headers("Bearer short"), "short")).toBe("disabled");
  });

  it.each([
    undefined,
    "",
    "Bearer",
    "Bearer ",
    `Basic ${SECRET}`,
    SECRET,
    "Bearer wrong",
    `Bearer ${SECRET}x`,
    `bearer ${SECRET}`,
  ])("refuses everything else: %j", (header) => {
    expect(checkCronAccess(headers(header), SECRET)).toBe("denied");
  });
});
