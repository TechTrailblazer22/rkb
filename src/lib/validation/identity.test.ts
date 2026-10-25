import { describe, expect, it } from "vitest";
import {
  isValidGstin,
  isValidPan,
  isValidPincode,
  normalizeGstin,
  normalizeMobile,
  normalizePan,
  panFromGstin,
} from "@/lib/validation/identity";

describe("PAN", () => {
  it("accepts the standard format, ignoring case and spaces", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
    expect(isValidPan(" abcde 1234 f ")).toBe(true);
    expect(normalizePan(" abcde 1234 f ")).toBe("ABCDE1234F");
  });

  it.each(["ABCDE12345", "ABCD1234FG", "1BCDE1234F", "ABCDE1234", "ABCDE1234FF", ""])(
    "rejects %j",
    (value) => expect(isValidPan(value)).toBe(false),
  );
});

describe("GSTIN", () => {
  // A widely published example GSTIN with a correct check character.
  const VALID = "27AAPFU0939F1ZV";

  it("accepts a correct GSTIN", () => {
    expect(isValidGstin(VALID)).toBe(true);
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true);
    expect(normalizeGstin(" 27aapfu0939f1zv ")).toBe(VALID);
  });

  it("rejects a wrong check character", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
  });

  it("rejects a single mistyped digit", () => {
    expect(isValidGstin("27AAPFU0938F1ZV")).toBe(false);
  });

  it.each(["", "27AAPFU0939F1Z", "27AAPFU0939F1XV", "AAAAAAAAAAAAAAA", "27AAPFU0939F1ZVV"])(
    "rejects malformed %j",
    (value) => expect(isValidGstin(value)).toBe(false),
  );

  it("extracts the embedded PAN", () => {
    expect(panFromGstin(VALID)).toBe("AAPFU0939F");
  });
});

describe("normalizeMobile", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765-43210", "9876543210"],
  ])("normalises %j", (input, expected) => expect(normalizeMobile(input)).toBe(expected));

  it.each(["5876543210", "98765", "98765432101", "abcdefghij", ""])("rejects %j", (input) =>
    expect(normalizeMobile(input)).toBeNull(),
  );
});

describe("isValidPincode", () => {
  it("accepts six digits not starting with zero", () => {
    expect(isValidPincode("641001")).toBe(true);
    expect(isValidPincode(" 600001 ")).toBe(true);
  });
  it.each(["012345", "64100", "6410011", "64100a"])("rejects %j", (value) =>
    expect(isValidPincode(value)).toBe(false),
  );
});

describe("completeGstin", () => {
  it("adds the check character that isValidGstin expects", async () => {
    const { completeGstin } = await import("@/lib/validation/identity");
    expect(completeGstin("27AAPFU0939F1Z")).toBe("27AAPFU0939F1ZV");
    expect(isValidGstin(completeGstin("33ABCDE1234F1Z"))).toBe(true);
  });
});
