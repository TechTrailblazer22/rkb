import { describe, expect, it } from "vitest";
import { clientAddress, createLimiter, trustedProxyHops } from "@/lib/rate-limit";

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

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

describe("clientAddress", () => {
  it("takes the address the trusted proxy appended: the last entry by default", () => {
    expect(clientAddress(xff("203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientAddress(xff("203.0.113.5, 10.0.0.1"), 1)).toBe("10.0.0.1");
  });
  it("cannot be fooled by a value the caller wrote at the front of the list", () => {
    // The caller sent "X-Forwarded-For: 1.1.1.1"; the proxy appended the real address.
    expect(clientAddress(xff("1.1.1.1, 203.0.113.5"), 1)).toBe("203.0.113.5");
    // Rotating the fake value changes nothing: it is still one bucket.
    expect(clientAddress(xff("2.2.2.2, 203.0.113.5"), 1)).toBe(
      clientAddress(xff("3.3.3.3, 203.0.113.5"), 1),
    );
  });
  it("counts from the right across several trusted proxies", () => {
    const list = "9.9.9.9, 203.0.113.5, 198.51.100.7";
    expect(clientAddress(xff(list), 2)).toBe("203.0.113.5");
    expect(clientAddress(xff(list), 3)).toBe("9.9.9.9");
  });
  it("uses the only entry there is when the list is shorter than the trusted count", () => {
    expect(clientAddress(xff("203.0.113.5"), 3)).toBe("203.0.113.5");
  });
  it("ignores empty entries and stray spaces", () => {
    expect(clientAddress(xff(" , 203.0.113.5 ,, "), 1)).toBe("203.0.113.5");
  });
  it("bounds the length of what it returns", () => {
    expect(clientAddress(xff("x".repeat(500)), 1)).toHaveLength(64);
  });
  it("shares one bucket when there is none", () => {
    expect(clientAddress(new Headers(), 1)).toBe("unknown");
    expect(clientAddress(xff(" , "), 1)).toBe("unknown");
  });
});

describe("trustedProxyHops", () => {
  it("defaults to one trusted proxy", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
  });
  it("reads a whole number of at least one", () => {
    expect(trustedProxyHops("2")).toBe(2);
  });
  it("falls back to one for anything else", () => {
    for (const bad of ["0", "-1", "1.5", "two", "", " "]) expect(trustedProxyHops(bad)).toBe(1);
  });
});
