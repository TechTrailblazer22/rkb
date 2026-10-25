import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/builders/slug";

describe("slugify", () => {
  it("makes a clean url segment", () => {
    expect(slugify("Anand Realty & Sons (P) Ltd.")).toBe("anand-realty-and-sons-p-ltd");
    expect(slugify("  Sri  Vari   Developers ")).toBe("sri-vari-developers");
  });

  it("drops accents and symbols", () => {
    expect(slugify("Café Řeality")).toBe("cafe-reality");
    expect(slugify("<script>alert(1)</script>")).toBe("script-alert-1-script");
  });

  it("is empty for names with no usable characters, and bounded in length", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("uniqueSlug", () => {
  it("uses the plain slug when free", async () => {
    expect(await uniqueSlug("Anand Realty", async () => false)).toBe("anand-realty");
  });

  it("adds a number when taken", async () => {
    const taken = new Set(["anand-realty", "anand-realty-2"]);
    expect(await uniqueSlug("Anand Realty", async (s) => taken.has(s))).toBe("anand-realty-3");
  });

  it("falls back to 'builder' for an unusable name", async () => {
    expect(await uniqueSlug("???", async () => false)).toBe("builder");
  });
});
