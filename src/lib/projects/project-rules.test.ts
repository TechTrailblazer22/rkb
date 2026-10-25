import { describe, expect, it } from "vitest";
import {
  buildProjectChecklist,
  type ChecklistInput,
  type ChecklistProject,
} from "@/lib/projects/checklist";
import {
  PROJECT_FIELDS,
  PROJECT_FIELD_KEYS,
  STEPS,
  parseProjectInput,
  projectToFormValues,
} from "@/lib/projects/fields";

const NOW = new Date("2026-06-01T00:00:00Z");

function completeProject(overrides: Partial<ChecklistProject> = {}): ChecklistProject {
  return {
    name: "Green Valley",
    city: "Coimbatore",
    locality: "Sulur",
    addressLine: "Survey 12, Sulur Road",
    mapUrl: null,
    description: "A DTCP approved plotted layout close to the bypass with all utilities ready.",
    acres: 12.5,
    totalPlots: 100,
    openAreaPercent: 15,
    landUse: "Residential",
    titleStatus: "Clear and marketable",
    startDate: null,
    completionDate: null,
    percentComplete: null,
    pricePerSqft: 1850,
    budgetFrom: null,
    budgetTo: null,
    tokenAmount: null,
    paymentPlan: null,
    amenities: [],
    videoUrl: null,
    contactName: "Anand",
    contactMobile: "9876543210",
    whatsapp: null,
    visitingHours: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<ChecklistInput> = {},
  project: Partial<ChecklistProject> = {},
): ChecklistInput {
  return {
    project: completeProject(project),
    plotCount: 40,
    pricedPlotCount: 40,
    approvals: [
      { kind: "RERA", number: "TN/29/Layout/0123/2026", validTill: new Date("2030-01-01") },
    ],
    photoCount: 5,
    hasLayout: false,
    hasBrochure: false,
    now: NOW,
    ...overrides,
  };
}

describe("buildProjectChecklist", () => {
  it("is submittable when every required item is done", () => {
    const list = buildProjectChecklist(input());
    expect(list.missingRequired).toEqual([]);
    expect(list.canSubmit).toBe(true);
  });

  it("scores required items higher than recommended ones, and 100 only when all are done", () => {
    const base = buildProjectChecklist(input());
    expect(base.percent).toBeGreaterThan(60);
    expect(base.percent).toBeLessThan(100);

    const full = buildProjectChecklist(
      input(
        { hasLayout: true, hasBrochure: true },
        {
          mapUrl: "https://maps.google.com/x",
          startDate: new Date("2025-01-01"),
          completionDate: new Date("2027-01-01"),
          percentComplete: 40,
          tokenAmount: 50000,
          paymentPlan: "10% on booking",
          amenities: ["park", "gym", "security"],
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          whatsapp: "9876543210",
          visitingHours: "9am to 6pm",
        },
      ),
    );
    expect(full.percent).toBe(100);
  });

  it("a brand new empty project is far from done", () => {
    const list = buildProjectChecklist({
      project: completeProject({
        city: null,
        locality: null,
        addressLine: null,
        description: null,
        totalPlots: null,
        acres: null,
        openAreaPercent: null,
        landUse: null,
        titleStatus: null,
        pricePerSqft: null,
        contactName: null,
        contactMobile: null,
      }),
      plotCount: 0,
      pricedPlotCount: 0,
      approvals: [],
      photoCount: 0,
      hasLayout: false,
      hasBrochure: false,
      now: NOW,
    });
    expect(list.canSubmit).toBe(false);
    expect(list.percent).toBeLessThan(15);
    expect(list.missingRequired.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        "city",
        "locality",
        "description",
        "totalPlots",
        "plots",
        "approval",
        "landUse",
        "price",
        "photos",
        "contactName",
      ]),
    );
  });

  it("a short description does not count", () => {
    expect(buildProjectChecklist(input({}, { description: "Nice plots." })).canSubmit).toBe(false);
  });

  it("accepts prices on the plots instead of a price per sq ft", () => {
    expect(
      buildProjectChecklist(input({ pricedPlotCount: 10 }, { pricePerSqft: null })).canSubmit,
    ).toBe(true);
    expect(
      buildProjectChecklist(input({ pricedPlotCount: 0 }, { pricePerSqft: null })).canSubmit,
    ).toBe(false);
  });

  it("needs an approval with a number, and ignores one that has expired", () => {
    expect(
      buildProjectChecklist(input({ approvals: [{ kind: "RERA", number: " ", validTill: null }] }))
        .canSubmit,
    ).toBe(false);
    const expired = buildProjectChecklist(
      input({ approvals: [{ kind: "TNCP", number: "TNCP/1", validTill: new Date("2025-12-31") }] }),
    );
    expect(expired.canSubmit).toBe(false);
    expect(expired.problems.some((p) => p.message.includes("expired"))).toBe(true);
  });

  it("an approval that expires today is still valid", () => {
    const list = buildProjectChecklist(
      input({ approvals: [{ kind: "RERA", number: "R/1", validTill: new Date("2026-06-01") }] }),
    );
    expect(list.canSubmit).toBe(true);
  });

  it("needs at least three photos", () => {
    expect(buildProjectChecklist(input({ photoCount: 2 })).canSubmit).toBe(false);
    expect(buildProjectChecklist(input({ photoCount: 3 })).canSubmit).toBe(true);
  });

  it.each([
    ["price band reversed", { budgetFrom: 9_000_000, budgetTo: 1_000_000 }, "pricing"],
    [
      "completion before start",
      { startDate: new Date("2027-01-01"), completionDate: new Date("2026-01-01") },
      "timeline",
    ],
    ["more plots than the total", { totalPlots: 10 }, "plots"],
  ])("blocks submitting when there is a contradiction: %s", (_name, project, step) => {
    const list = buildProjectChecklist(input({ plotCount: 40 }, project));
    expect(list.canSubmit).toBe(false);
    expect(list.problems.map((p) => p.step)).toContain(step);
    expect(list.stepDone[step as keyof typeof list.stepDone]).toBe(false);
  });

  it("marks steps done independently", () => {
    const list = buildProjectChecklist(input({ photoCount: 1 }));
    expect(list.stepDone.basics).toBe(true);
    expect(list.stepDone.media).toBe(false);
    expect(list.stepDone.review).toBe(false);
  });
});

describe("parseProjectInput", () => {
  it("normalises values for a step", () => {
    const { updates, errors } = parseProjectInput(
      "pricing",
      {
        pricePerSqft: "₹1,850",
        budgetFrom: "18,50,000",
        tokenAmount: "50000",
        paymentPlan: "  10% now  ",
      },
      "full",
    );
    expect(errors).toEqual({});
    expect(updates).toEqual({
      pricePerSqft: 1850,
      budgetFrom: 1_850_000,
      tokenAmount: 50000,
      paymentPlan: "10% now",
    });
  });

  it("keeps the good fields and reports only the bad ones", () => {
    const { updates, errors } = parseProjectInput(
      "layout",
      { acres: "12.5", totalPlots: "lots", openAreaPercent: "150" },
      "full",
    );
    expect(updates).toEqual({ acres: 12.5 });
    expect(Object.keys(errors).sort()).toEqual(["openAreaPercent", "totalPlots"]);
  });

  it("ignores fields that belong to a different step", () => {
    const { updates, errors } = parseProjectInput(
      "basics",
      { name: "Green Valley", pricePerSqft: "1850", status: "LIVE", builderId: "x" },
      "full",
    );
    expect(updates).toEqual({ name: "Green Valley" });
    expect(errors).toEqual({});
  });

  it("clears optional fields when emptied but refuses to empty required columns", () => {
    const { updates, errors } = parseProjectInput(
      "basics",
      { city: "", name: "", mapUrl: "" },
      "full",
    );
    expect(updates).toEqual({ city: null, mapUrl: null });
    expect(errors.name).toContain("cannot be empty");
  });

  it("turns lists into arrays and validates amenity codes", () => {
    expect(parseProjectInput("amenities", { amenities: "park,gym,park" }, "full").updates).toEqual({
      amenities: ["park", "gym"],
    });
    expect(parseProjectInput("amenities", { amenities: "" }, "full").updates).toEqual({
      amenities: [],
    });
    expect(
      parseProjectInput("amenities", { amenities: "park,helipad" }, "full").errors.amenities,
    ).toBeTruthy();
    expect(
      parseProjectInput("approvals", { bankLoans: "SBI, HDFC , sbi" }, "full").updates,
    ).toEqual({ bankLoans: ["SBI", "HDFC"] });
  });

  it("normalises YouTube links and rejects other video sites", () => {
    expect(
      parseProjectInput("media", { videoUrl: "https://youtu.be/dQw4w9WgXcQ?si=1" }, "full").updates,
    ).toEqual({
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(
      parseProjectInput("media", { videoUrl: "https://vimeo.com/1" }, "full").errors.videoUrl,
    ).toBeTruthy();
  });

  it("only accepts https map links", () => {
    expect(
      parseProjectInput("basics", { mapUrl: "https://maps.google.com/?q=12,77" }, "full").errors,
    ).toEqual({});
    expect(
      parseProjectInput("basics", { mapUrl: "http://maps.example.com" }, "full").errors.mapUrl,
    ).toBeTruthy();
    expect(
      parseProjectInput("basics", { mapUrl: "javascript:alert(1)" }, "full").errors.mapUrl,
    ).toBeTruthy();
  });

  it("handles contact numbers and the show/hide choice", () => {
    const { updates } = parseProjectInput(
      "contact",
      { contactMobile: "+91 98765 43210", hideContactNumber: "hide" },
      "full",
    );
    expect(updates).toEqual({ contactMobile: "9876543210", hideContactNumber: true });
    expect(parseProjectInput("contact", { hideContactNumber: "show" }, "full").updates).toEqual({
      hideContactNumber: false,
    });
    expect(
      parseProjectInput("contact", { contactMobile: "123" }, "full").errors.contactMobile,
    ).toBeTruthy();
  });

  it("validates dates", () => {
    expect(
      parseProjectInput("timeline", { startDate: "2026-02-31" }, "full").errors.startDate,
    ).toBeTruthy();
    expect(
      parseProjectInput("timeline", { startDate: "1980-01-01" }, "full").errors.startDate,
    ).toBeTruthy();
    expect(
      parseProjectInput("timeline", { startDate: "2026-02-14" }, "full").updates.startDate,
    ).toEqual(new Date("2026-02-14T00:00:00.000Z"));
  });

  it("refuses everything when locked", () => {
    const { updates, errors } = parseProjectInput("basics", { description: "x" }, "locked");
    expect(updates).toEqual({});
    expect(errors.description).toBeTruthy();
  });

  it("lets a live project change cosmetic fields but not the material ones", () => {
    const basics = parseProjectInput(
      "basics",
      { description: "A better description.", name: "Renamed", city: "Elsewhere" },
      "cosmetic",
    );
    expect(basics.updates).toEqual({ description: "A better description." });
    expect(Object.keys(basics.errors).sort()).toEqual(["city", "name"]);

    const legal = parseProjectInput(
      "approvals",
      { landUse: "Commercial", titleStatus: "Clear and marketable" },
      "cosmetic",
    );
    expect(legal.updates).toEqual({});
    expect(Object.keys(legal.errors).sort()).toEqual(["landUse", "titleStatus"]);

    expect(parseProjectInput("pricing", { pricePerSqft: "2100" }, "cosmetic").updates).toEqual({
      pricePerSqft: 2100,
    });
  });
});

describe("field definitions", () => {
  it("every field belongs to a real wizard step", () => {
    const stepSlugs: string[] = STEPS.map((s) => s.slug);
    for (const key of PROJECT_FIELD_KEYS) expect(stepSlugs).toContain(PROJECT_FIELDS[key].step);
  });

  it("round-trips a project into form values", () => {
    const values = projectToFormValues({
      name: "Green Valley",
      type: "PLOTTED",
      stage: "READY_TO_MOVE",
      city: "Coimbatore",
      locality: null,
      addressLine: null,
      mapUrl: null,
      description: null,
      acres: 12.5,
      totalPlots: 100,
      openAreaPercent: null,
      phasesCount: null,
      landUse: null,
      titleStatus: null,
      bankLoans: ["SBI", "HDFC"],
      startDate: new Date("2026-02-14T00:00:00Z"),
      completionDate: null,
      percentComplete: null,
      pricePerSqft: 1850,
      budgetFrom: null,
      budgetTo: null,
      tokenAmount: null,
      paymentPlan: null,
      additionalCharges: null,
      offers: null,
      amenities: ["park", "gym"],
      videoUrl: null,
      contactName: null,
      contactMobile: null,
      whatsapp: null,
      visitingHours: null,
      hideContactNumber: true,
    });
    expect(values).toMatchObject({
      name: "Green Valley",
      acres: "12.5",
      totalPlots: "100",
      locality: "",
      bankLoans: "SBI, HDFC",
      startDate: "2026-02-14",
      amenities: "park,gym",
      hideContactNumber: "hide",
      pricePerSqft: "1850",
    });
  });
});
