import { describe, expect, it } from "vitest";
import {
  REQUIRED_PROFILE_KEYS,
  buildChecklist,
  crossFieldProblems,
  parseProfileInput,
  type ProfileSnapshot,
} from "@/lib/builders/profile";
import { REQUIRED_DOCUMENT_KINDS } from "@/lib/builders/documents";

const VALID_GSTIN = "27AAPFU0939F1ZV";
const MATCHING_PAN = "AAPFU0939F";

function profile(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    companyName: "Anand Realty",
    type: "PRIVATE_LIMITED",
    yearEstablished: 2010,
    projectsCompleted: null,
    projectsOngoing: null,
    about: null,
    website: null,
    contactPerson: "Anand K",
    contactMobile: "9876543210",
    whatsapp: null,
    addressLine: "12 Race Course Road",
    city: "Coimbatore",
    state: "Tamil Nadu",
    pincode: "641018",
    serviceCities: [],
    pan: MATCHING_PAN,
    gstin: VALID_GSTIN,
    reraNumber: null,
    reraValidTill: null,
    interestedPlan: "GROWTH",
    ...overrides,
  };
}

const allRequiredDocs = REQUIRED_DOCUMENT_KINDS.map((kind) => ({
  kind,
  status: "PENDING" as const,
}));

describe("parseProfileInput", () => {
  it("normalises valid values", () => {
    const { updates, errors } = parseProfileInput(
      {
        companyName: "  Anand Realty  ",
        pan: "aapfu 0939 f",
        gstin: "27aapfu0939f1zv",
        contactMobile: "+91 98765 43210",
        yearEstablished: "2010",
        pincode: "641 018".replace(" ", ""),
        website: "www.anandrealty.in",
        serviceCities: "Coimbatore, Chennai,\ncoimbatore",
        reraValidTill: "2030-05-17",
      },
      "full",
    );
    expect(errors).toEqual({});
    expect(updates).toMatchObject({
      companyName: "Anand Realty",
      pan: "AAPFU0939F",
      gstin: "27AAPFU0939F1ZV",
      contactMobile: "9876543210",
      yearEstablished: 2010,
      pincode: "641018",
      website: "https://www.anandrealty.in",
      serviceCities: ["Coimbatore", "Chennai"],
    });
    expect(updates.reraValidTill).toEqual(new Date("2030-05-17T00:00:00.000Z"));
  });

  it("keeps the good fields and reports only the bad ones", () => {
    const { updates, errors } = parseProfileInput(
      { companyName: "Anand Realty", pan: "NOT-A-PAN", pincode: "12" },
      "full",
    );
    expect(updates).toEqual({ companyName: "Anand Realty" });
    expect(Object.keys(errors).sort()).toEqual(["pan", "pincode"]);
  });

  it("treats an empty value as clearing the field", () => {
    const { updates, errors } = parseProfileInput({ website: "", serviceCities: "" }, "full");
    expect(errors).toEqual({});
    expect(updates).toEqual({ website: null, serviceCities: [] });
  });

  it("ignores keys that are not profile fields", () => {
    const { updates } = parseProfileInput({ status: "VERIFIED", role: "ADMIN", id: "x" }, "full");
    expect(updates).toEqual({});
  });

  it("rejects impossible values", () => {
    const { errors } = parseProfileInput(
      {
        yearEstablished: "1850",
        projectsCompleted: "-3",
        state: "Atlantis",
        type: "WIZARD",
        reraValidTill: "2030-02-31",
        about: "x".repeat(501),
        website: "not a url",
      },
      "full",
    );
    expect(Object.keys(errors).sort()).toEqual([
      "about",
      "projectsCompleted",
      "reraValidTill",
      "state",
      "type",
      "website",
      "yearEstablished",
    ]);
  });

  it("refuses all edits while locked", () => {
    const { updates, errors } = parseProfileInput({ companyName: "Hacked Ltd" }, "locked");
    expect(updates).toEqual({});
    expect(errors.companyName).toBeTruthy();
  });

  it("lets a verified builder change presentation fields but not legal identity", () => {
    const { updates, errors } = parseProfileInput(
      { about: "We build homes.", companyName: "Renamed Ltd", pan: "ABCDE1234F" },
      "presentation",
    );
    expect(updates).toEqual({ about: "We build homes." });
    expect(Object.keys(errors).sort()).toEqual(["companyName", "pan"]);
  });
});

describe("crossFieldProblems", () => {
  it("flags a PAN that does not match the GSTIN", () => {
    expect(crossFieldProblems(profile({ pan: "ABCDE1234F" }))).toHaveLength(1);
  });

  it("accepts a matching PAN and GSTIN", () => {
    expect(crossFieldProblems(profile())).toEqual([]);
  });

  it("flags an expired RERA date", () => {
    expect(crossFieldProblems(profile({ reraValidTill: new Date("2020-01-01") }))).toHaveLength(1);
  });
});

describe("buildChecklist", () => {
  it("is submittable when everything required is present", () => {
    const list = buildChecklist(profile(), allRequiredDocs);
    expect(list.percent).toBe(100);
    expect(list.canSubmit).toBe(true);
  });

  it("reports what is missing", () => {
    const list = buildChecklist(
      profile({ companyName: null, pan: "", interestedPlan: null }),
      allRequiredDocs.slice(1),
    );
    expect(list.canSubmit).toBe(false);
    expect(list.profile.missing.map((m) => m.key).sort()).toEqual(["companyName", "pan"]);
    expect(list.documents.missing).toEqual(["PAN"]);
    expect(list.plan.done).toBe(false);
    expect(list.percent).toBeLessThan(100);
  });

  it("counts an empty profile as 0 percent", () => {
    const empty = profile({
      companyName: null,
      type: null,
      yearEstablished: null,
      contactPerson: null,
      contactMobile: null,
      addressLine: null,
      city: null,
      state: null,
      pincode: null,
      pan: null,
      gstin: null,
      interestedPlan: null,
    });
    expect(buildChecklist(empty, []).percent).toBe(0);
    expect(REQUIRED_PROFILE_KEYS.length).toBe(11);
  });

  it("blocks submission while a document is rejected", () => {
    const docs = allRequiredDocs.map((d, i) =>
      i === 0 ? { ...d, status: "REJECTED" as const } : d,
    );
    const list = buildChecklist(profile(), docs);
    expect(list.documents.rejected).toEqual(["PAN"]);
    expect(list.canSubmit).toBe(false);
  });

  it("blocks submission when the PAN and GSTIN disagree", () => {
    const list = buildChecklist(profile({ pan: "ABCDE1234F" }), allRequiredDocs);
    expect(list.profile.done).toBe(false);
    expect(list.canSubmit).toBe(false);
  });
});

describe("profileToFormValues", () => {
  it("turns stored values into form strings", async () => {
    const { profileToFormValues } = await import("@/lib/builders/profile");
    const values = profileToFormValues(
      profile({
        yearEstablished: 2010,
        serviceCities: ["Coimbatore", "Chennai"],
        reraValidTill: new Date("2030-05-17T00:00:00.000Z"),
        website: null,
      }),
    );
    expect(values.yearEstablished).toBe("2010");
    expect(values.serviceCities).toBe("Coimbatore, Chennai");
    expect(values.reraValidTill).toBe("2030-05-17");
    expect(values.website).toBe("");
    expect(values.companyName).toBe("Anand Realty");
  });
});
