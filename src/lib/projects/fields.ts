import type { Project } from "@/generated/prisma/client";
import type { ProjectStage, ProjectType } from "@/generated/prisma/enums";
import { AMENITY_CODES } from "@/lib/projects/amenities";
import type { ProjectEditMode } from "@/lib/projects/status";
import { parseYouTubeId, youTubeWatchUrl } from "@/lib/projects/video";
import { normalizeMobile } from "@/lib/validation/identity";

export const PROJECT_TYPES: { value: ProjectType; label: string }[] = [
  { value: "PLOTTED", label: "Plotted layout" },
  { value: "FARM_HOUSE", label: "Farm house / farmland" },
  { value: "RESIDENTIAL", label: "Residential (apartments, villas)" },
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "MIXED_USE", label: "Mixed use" },
];

export const PROJECT_STAGES: { value: ProjectStage; label: string }[] = [
  { value: "PRE_LAUNCH", label: "Pre-launch" },
  { value: "UNDER_CONSTRUCTION", label: "Under construction / development" },
  { value: "READY_TO_MOVE", label: "Ready to move" },
];

export const LAND_USES = [
  "Residential",
  "Agricultural, converted",
  "Agricultural",
  "Commercial",
  "Mixed use",
  "Industrial",
];

export const TITLE_STATUSES = [
  "Clear and marketable",
  "Verification in progress",
  "Joint development",
];

/** The wizard, in order. "plots" and "review" have no autosaved Project fields of their own. */
export const STEPS = [
  { slug: "basics", label: "Basics" },
  { slug: "layout", label: "Size and layout" },
  { slug: "plots", label: "Plots and units" },
  { slug: "approvals", label: "Legal and approvals" },
  { slug: "timeline", label: "Timeline and status" },
  { slug: "pricing", label: "Pricing" },
  { slug: "amenities", label: "Amenities" },
  { slug: "media", label: "Media" },
  { slug: "contact", label: "Contact" },
  { slug: "review", label: "Review and submit" },
] as const;

export type StepSlug = (typeof STEPS)[number]["slug"];
export type FormStep =
  "basics" | "layout" | "approvals" | "timeline" | "pricing" | "amenities" | "media" | "contact";

export function isStepSlug(value: string): value is StepSlug {
  return STEPS.some((step) => step.slug === value);
}

export type ProjectFieldKey =
  | "name"
  | "type"
  | "stage"
  | "city"
  | "locality"
  | "addressLine"
  | "mapUrl"
  | "description"
  | "acres"
  | "totalPlots"
  | "openAreaPercent"
  | "phasesCount"
  | "landUse"
  | "titleStatus"
  | "bankLoans"
  | "startDate"
  | "completionDate"
  | "percentComplete"
  | "pricePerSqft"
  | "budgetFrom"
  | "budgetTo"
  | "tokenAmount"
  | "paymentPlan"
  | "additionalCharges"
  | "offers"
  | "amenities"
  | "videoUrl"
  | "tourUrl"
  | "contactName"
  | "contactMobile"
  | "whatsapp"
  | "visitingHours"
  | "hideContactNumber";

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };
type FieldDef = {
  step: FormStep;
  label: string;
  /**
   * Identifies or legally describes the project. Once a project is live these are locked, so the
   * reviewed listing cannot silently change into a different one. Everything else stays editable.
   */
  material: boolean;
  /** Empty input clears the field, unless the column cannot be empty. */
  nullable: boolean;
  parse: (raw: string) => ParseResult;
};

const ok = (value: unknown): ParseResult => ({ ok: true, value });
const fail = (error: string): ParseResult => ({ ok: false, error });

const text =
  (label: string, min: number, max: number) =>
  (raw: string): ParseResult =>
    raw.length < min
      ? fail(`${label} must be at least ${min} characters.`)
      : raw.length > max
        ? fail(`${label} must be at most ${max} characters.`)
        : ok(raw);

const whole =
  (label: string, min: number, max: number) =>
  (raw: string): ParseResult => {
    const cleaned = raw.replace(/[,\s₹]/g, "");
    if (!/^\d+$/.test(cleaned)) return fail(`${label} must be a whole number.`);
    const value = Number(cleaned);
    return value < min || value > max
      ? fail(
          `${label} must be between ${min.toLocaleString("en-IN")} and ${max.toLocaleString("en-IN")}.`,
        )
      : ok(value);
  };

const decimal =
  (label: string, min: number, max: number) =>
  (raw: string): ParseResult => {
    const cleaned = raw.replace(/[,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return fail(`${label} must be a number.`);
    const value = Math.round(Number(cleaned) * 100) / 100;
    return value < min || value > max
      ? fail(`${label} must be between ${min} and ${max.toLocaleString("en-IN")}.`)
      : ok(value);
  };

const oneOf =
  (label: string, allowed: string[]) =>
  (raw: string): ParseResult =>
    allowed.includes(raw) ? ok(raw) : fail(`Choose a valid ${label.toLowerCase()}.`);

function isoDate(raw: string): ParseResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail("Enter a valid date.");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw)
    return fail("Enter a valid date.");
  const year = date.getUTCFullYear();
  return year < 1990 || year > 2100 ? fail("Enter a date between 1990 and 2100.") : ok(date);
}

function httpsUrl(raw: string): ParseResult {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || raw.length > 300) throw new Error("not https");
    return ok(url.toString());
  } catch {
    return fail("Enter a full web address starting with https://");
  }
}

function listOf(label: string, max: number, itemMax: number) {
  return (raw: string): ParseResult => {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const part of raw.split(/[,\n]/)) {
      const item = part.trim().replace(/\s+/g, " ");
      if (!item || seen.has(item.toLowerCase())) continue;
      if (item.length > itemMax)
        return fail(`Each ${label} must be at most ${itemMax} characters.`);
      seen.add(item.toLowerCase());
      items.push(item);
    }
    return items.length > max ? fail(`List at most ${max} items.`) : ok(items);
  };
}

function amenityList(raw: string): ParseResult {
  const codes = [
    ...new Set(
      raw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
  const unknown = codes.find((code) => !AMENITY_CODES.has(code));
  return unknown ? fail("One of the amenities is not recognised.") : ok(codes);
}

export const PROJECT_FIELDS: Record<ProjectFieldKey, FieldDef> = {
  name: {
    step: "basics",
    label: "Project name",
    material: true,
    nullable: false,
    parse: text("Project name", 3, 100),
  },
  type: {
    step: "basics",
    label: "Project type",
    material: true,
    nullable: false,
    parse: oneOf(
      "project type",
      PROJECT_TYPES.map((t) => t.value),
    ),
  },
  stage: {
    step: "basics",
    label: "Stage",
    material: false,
    nullable: false,
    parse: oneOf(
      "stage",
      PROJECT_STAGES.map((s) => s.value),
    ),
  },
  city: {
    step: "basics",
    label: "City",
    material: true,
    nullable: true,
    parse: text("City", 2, 60),
  },
  locality: {
    step: "basics",
    label: "Locality",
    material: true,
    nullable: true,
    parse: text("Locality", 2, 80),
  },
  addressLine: {
    step: "basics",
    label: "Site address",
    material: true,
    nullable: true,
    parse: text("Site address", 5, 200),
  },
  mapUrl: { step: "basics", label: "Map link", material: false, nullable: true, parse: httpsUrl },
  description: {
    step: "basics",
    label: "Description",
    material: false,
    nullable: true,
    parse: text("Description", 0, 1500),
  },

  acres: {
    step: "layout",
    label: "Project size (acres)",
    material: false,
    nullable: true,
    parse: decimal("Project size", 0.01, 100000),
  },
  totalPlots: {
    step: "layout",
    label: "Total number of plots or units",
    material: false,
    nullable: true,
    parse: whole("Total plots", 1, 5000),
  },
  openAreaPercent: {
    step: "layout",
    label: "Open area (%)",
    material: false,
    nullable: true,
    parse: whole("Open area", 0, 100),
  },
  phasesCount: {
    step: "layout",
    label: "Number of phases",
    material: false,
    nullable: true,
    parse: whole("Phases", 1, 50),
  },

  landUse: {
    step: "approvals",
    label: "Land use",
    material: true,
    nullable: true,
    parse: oneOf("land use", LAND_USES),
  },
  titleStatus: {
    step: "approvals",
    label: "Title status",
    material: true,
    nullable: true,
    parse: oneOf("title status", TITLE_STATUSES),
  },
  bankLoans: {
    step: "approvals",
    label: "Banks offering loans",
    material: true,
    nullable: true,
    parse: listOf("bank name", 15, 40),
  },

  startDate: {
    step: "timeline",
    label: "Start date",
    material: false,
    nullable: true,
    parse: isoDate,
  },
  completionDate: {
    step: "timeline",
    label: "Expected completion",
    material: false,
    nullable: true,
    parse: isoDate,
  },
  percentComplete: {
    step: "timeline",
    label: "Percent complete",
    material: false,
    nullable: true,
    parse: whole("Percent complete", 0, 100),
  },

  pricePerSqft: {
    step: "pricing",
    label: "Price per sq ft (₹)",
    material: false,
    nullable: true,
    parse: whole("Price per sq ft", 100, 10_000_000),
  },
  budgetFrom: {
    step: "pricing",
    label: "Starting price (₹)",
    material: false,
    nullable: true,
    parse: whole("Starting price", 10_000, 10_000_000_000),
  },
  budgetTo: {
    step: "pricing",
    label: "Highest price (₹)",
    material: false,
    nullable: true,
    parse: whole("Highest price", 10_000, 10_000_000_000),
  },
  tokenAmount: {
    step: "pricing",
    label: "Token amount (₹)",
    material: false,
    nullable: true,
    parse: whole("Token amount", 1_000, 100_000_000),
  },
  paymentPlan: {
    step: "pricing",
    label: "Payment plan",
    material: false,
    nullable: true,
    parse: text("Payment plan", 0, 1000),
  },
  additionalCharges: {
    step: "pricing",
    label: "Additional charges",
    material: false,
    nullable: true,
    parse: text("Additional charges", 0, 1000),
  },
  offers: {
    step: "pricing",
    label: "Current offers",
    material: false,
    nullable: true,
    parse: text("Offers", 0, 1000),
  },

  amenities: {
    step: "amenities",
    label: "Amenities",
    material: false,
    nullable: true,
    parse: amenityList,
  },

  videoUrl: {
    step: "media",
    label: "YouTube video link",
    material: false,
    nullable: true,
    parse: (raw) => {
      const id = parseYouTubeId(raw);
      return id
        ? ok(youTubeWatchUrl(id))
        : fail("Enter a YouTube link, for example https://youtu.be/...");
    },
  },

  tourUrl: {
    step: "media",
    label: "360° tour link",
    material: false,
    nullable: true,
    parse: (raw) => {
      const value = raw.trim();
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return fail("Enter the full link, starting with https://");
      }
      // Shown as a button that opens in a new tab, never embedded; still, only a plain https link.
      if (url.protocol !== "https:" || url.username || url.password) {
        return fail("Enter a secure link, starting with https://");
      }
      if (
        !url.hostname.includes(".") ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.includes(":")
      ) {
        return fail("Enter a link to a website, for example https://my.matterport.com/...");
      }
      return value.length > 300 ? fail("That link is too long.") : ok(url.toString());
    },
  },

  contactName: {
    step: "contact",
    label: "Contact person",
    material: false,
    nullable: true,
    parse: text("Contact person", 2, 80),
  },
  contactMobile: {
    step: "contact",
    label: "Contact mobile",
    material: false,
    nullable: true,
    parse: (raw) => {
      const value = normalizeMobile(raw);
      return value ? ok(value) : fail("Enter a valid 10 digit Indian mobile number.");
    },
  },
  whatsapp: {
    step: "contact",
    label: "WhatsApp number",
    material: false,
    nullable: true,
    parse: (raw) => {
      const value = normalizeMobile(raw);
      return value ? ok(value) : fail("Enter a valid 10 digit Indian mobile number.");
    },
  },
  visitingHours: {
    step: "contact",
    label: "Site visiting hours",
    material: false,
    nullable: true,
    parse: text("Visiting hours", 0, 100),
  },
  hideContactNumber: {
    step: "contact",
    label: "Show my number to buyers",
    material: false,
    nullable: false,
    parse: (raw) =>
      raw === "show" ? ok(false) : raw === "hide" ? ok(true) : fail("Choose show or hide."),
  },
};

export const PROJECT_FIELD_KEYS = Object.keys(PROJECT_FIELDS) as ProjectFieldKey[];

export type ProjectParseResult = {
  updates: Record<string, unknown>;
  errors: Record<string, string>;
};

/**
 * Validates one wizard step's values, field by field, like the company profile does: valid
 * fields are returned for saving even when others are wrong. Only fields that belong to the
 * given step are accepted, so one step's form can never write another step's data.
 */
export function parseProjectInput(
  step: FormStep,
  input: Record<string, string | undefined>,
  mode: ProjectEditMode,
): ProjectParseResult {
  const updates: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || !(key in PROJECT_FIELDS)) continue;
    const field = PROJECT_FIELDS[key as ProjectFieldKey];
    if (field.step !== step) continue;

    if (mode === "locked") {
      errors[key] = "This project can't be edited right now.";
      continue;
    }
    if (mode === "cosmetic" && field.material) {
      errors[key] = 'Locked while the project is live. Use "Edit and resubmit" to change it.';
      continue;
    }

    const value = raw.trim();
    if (value === "") {
      if (!field.nullable) errors[key] = `${field.label} cannot be empty.`;
      else updates[key] = ["bankLoans", "amenities"].includes(key) ? [] : null;
      continue;
    }
    const result = field.parse(value);
    if (result.ok) updates[key] = result.value;
    else errors[key] = result.error;
  }
  return { updates, errors };
}

export type ProjectFormValues = Record<ProjectFieldKey, string>;

/** Stored project to the plain strings an HTML form shows. */
export function projectToFormValues(project: Pick<Project, ProjectFieldKey>): ProjectFormValues {
  const values = {} as ProjectFormValues;
  for (const key of PROJECT_FIELD_KEYS) {
    const value = project[key];
    if (key === "hideContactNumber") values[key] = value ? "hide" : "show";
    else if (value === null || value === undefined) values[key] = "";
    else if (value instanceof Date) values[key] = value.toISOString().slice(0, 10);
    else if (Array.isArray(value)) values[key] = value.join(key === "amenities" ? "," : ", ");
    else values[key] = String(value);
  }
  return values;
}
