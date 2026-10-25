import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("accepts a valid environment and applies defaults", () => {
    const env = parseServerEnv({ DATABASE_URL: "postgresql://u:p@host/db" });
    expect(env.DATABASE_URL).toBe("postgresql://u:p@host/db");
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws a readable error when DATABASE_URL is missing", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "postgresql://u:p@host/db", NODE_ENV: "staging" }),
    ).toThrow(/NODE_ENV/);
  });
});
