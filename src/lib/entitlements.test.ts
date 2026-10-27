import { describe, expect, it } from "vitest";
import {
  GRACE_DAYS,
  LIMITS,
  cheapestPlanWith,
  entitlementsForPlan,
  isInForce,
} from "@/lib/entitlements";
import { comparison, plans } from "@/lib/plans";

const row = (label: string) => {
  const found = comparison.find((r) => r.label === label);
  if (!found) throw new Error(`No comparison row "${label}"`);
  return found.values;
};
const CODES = ["STARTER", "GROWTH", "PREMIER"] as const;

describe("the marketing table and the enforced limits agree", () => {
  it("projects", () => {
    expect(row("Projects")).toEqual(
      CODES.map((c) =>
        LIMITS[c].maxProjects === null ? "Unlimited" : `Up to ${LIMITS[c].maxProjects}`,
      ),
    );
  });

  it("photos per project", () => {
    expect(row("Photos per project")).toEqual(
      CODES.map((c) => String(LIMITS[c].maxPhotosPerProject)),
    );
  });

  it("video, 360 tour and layout map", () => {
    expect(row("Video")).toEqual(CODES.map((c) => LIMITS[c].video));
    expect(row("360° tour")).toEqual(CODES.map((c) => LIMITS[c].tour360));
    expect(row("Interactive layout map")).toEqual(CODES.map((c) => LIMITS[c].layoutMap));
  });

  it("team users", () => {
    expect(row("Team users")).toEqual(CODES.map((c) => String(LIMITS[c].teamSeats)));
  });

  it("lead dashboard", () => {
    expect(row("Lead dashboard")).toEqual(
      CODES.map((c) => (LIMITS[c].leads === "full" ? "Full" : "Basic")),
    );
  });

  it("analytics", () => {
    expect(row("Analytics")).toEqual(
      CODES.map(
        (c) =>
          ({ none: false, advanced: "Advanced", export: "Advanced with export" })[
            LIMITS[c].analytics
          ],
      ),
    );
  });

  it("homepage spotlight", () => {
    expect(row("Homepage spotlight")).toEqual(CODES.map((c) => LIMITS[c].homepageSpotlight));
  });

  it("the plan cards list the same project and photo numbers", () => {
    const features = (code: string) => plans.find((p) => p.code === code)!.features.join(" | ");
    expect(features("STARTER")).toContain("Up to 2 projects");
    expect(features("STARTER")).toContain("15 photos per project");
    expect(features("GROWTH")).toContain("Up to 6 projects");
    expect(features("GROWTH")).toContain("40 photos plus video");
    expect(features("GROWTH")).toContain("2 featured days per month");
  });
});

describe("entitlementsForPlan", () => {
  it("gives a plan its limits and lets it publish", () => {
    expect(entitlementsForPlan("GROWTH")).toMatchObject({
      plan: "GROWTH",
      active: true,
      canPublish: true,
      maxProjects: 6,
    });
  });

  it("lets a company with no plan prepare drafts, at the smallest size, but not go live", () => {
    expect(entitlementsForPlan(null)).toMatchObject({
      plan: null,
      active: false,
      canPublish: false,
      maxProjects: 2,
      video: false,
      leads: "basic",
      layoutMap: false,
      analytics: "none",
    });
  });

  it("never gives a lower plan something a higher plan lacks", () => {
    expect(LIMITS.PREMIER.maxProjects).toBeNull();
    expect(LIMITS.GROWTH.maxProjects!).toBeGreaterThan(LIMITS.STARTER.maxProjects!);
    expect(LIMITS.GROWTH.teamSeats).toBeGreaterThan(LIMITS.STARTER.teamSeats);
    expect(LIMITS.PREMIER.teamSeats).toBeGreaterThan(LIMITS.GROWTH.teamSeats);
    expect(LIMITS.STARTER.video).toBe(false);
  });
});

describe("isInForce", () => {
  const end = new Date("2026-11-10T00:00:00Z");
  const sub = { status: "ACTIVE", currentPeriodEnd: end };

  it("is in force through the period and the grace days after it", () => {
    expect(isInForce(sub, new Date("2026-11-09T00:00:00Z"))).toBe(true);
    expect(isInForce(sub, new Date(end.getTime() + GRACE_DAYS * 86_400_000))).toBe(true);
    expect(isInForce(sub, new Date(end.getTime() + GRACE_DAYS * 86_400_000 + 1))).toBe(false);
  });

  it("is not in force when expired, missing, or not active", () => {
    expect(
      isInForce({ status: "EXPIRED", currentPeriodEnd: end }, new Date("2026-11-01T00:00:00Z")),
    ).toBe(false);
    expect(isInForce(null)).toBe(false);
    expect(isInForce(undefined)).toBe(false);
  });
});

describe("cheapestPlanWith", () => {
  it("names the plan that unlocks a feature", () => {
    expect(cheapestPlanWith((l) => l.video)).toBe("GROWTH");
    expect(cheapestPlanWith((l) => l.tour360)).toBe("PREMIER");
    expect(cheapestPlanWith((l) => l.maxPhotosPerProject >= 15)).toBe("STARTER");
    expect(cheapestPlanWith((l) => l.teamSeats > 100)).toBeNull();
  });
});
