import { describe, expect, it } from "vitest";
import { clientAddress, createLimiter } from "@/lib/rate-limit";

describe("createLimiter", () => {
  it("allows up to the maximum in a window, then refuses", () => {
    const limiter = createLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3, 4, 5].map(() => limiter.hit("a", 0))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });
  it("counts each key separately", () => {
    const limiter = createLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.hit("a", 0)).toBe(false);
    expect(limiter.hit("b", 0)).toBe(false);
    expect(limiter.hit("a", 1)).toBe(true);
  });
  it("starts a fresh window once the old one is over", () => {
    const limiter = createLimiter({ max: 1, windowMs: 1000 });
    limiter.hit("a", 0);
    expect(limiter.hit("a", 500)).toBe(true);
    expect(limiter.hit("a", 1000)).toBe(false);
  });
  it("never holds more keys than allowed", () => {
    const limiter = createLimiter({ max: 1, windowMs: 1000, maxKeys: 10 });
    for (let i = 0; i < 50; i++) limiter.hit(`k${i}`, 0);
    // still works, and expired keys are swept
    expect(limiter.hit("fresh", 5000)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("takes the first address the proxy reports", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
  });
  it("shares one bucket when there is none", () => {
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
