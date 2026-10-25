import type { Prisma } from "@/generated/prisma/client";
import type { BuilderType, DocumentKind, DocumentStatus } from "@/generated/prisma/enums";
import type { EditMode } from "@/lib/builders/status";
import { REQUIRED_DOCUMENT_KINDS } from "@/lib/builders/documents";
import {
  isValidGstin,
  isValidPan,
  isValidPincode,
  normalizeGstin,
  normalizeMobile,
  normalizePan,
  panFromGstin,
} from "@/lib/validation/identity";

export const BUILDER_TYPES: { value: BuilderType; label: string }[] = [
  { value: "PROPRIETORSHIP", label: "Proprietorship" },
  { value: "PARTNERSHIP", label: "Partnership firm" },
  { value: "LLP", label: "LLP" },
  { value: "PRIVATE_LIMITED", label: "Private limited company" },
  { value: "PUBLIC_LIMITED", label: "Public limited company" },
  { value: "OTHER", label: "Other" },
];

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

export type ProfileKey =
  | "companyName"
  | "type"
  | "yearEstablished"
  | "projectsCompleted"
  | "projectsOngoing"
  | "about"
  | "website"
  | "contactPerson"
  | "contactMobile"
  | "whatsapp"
  | "addressLine"
  | "city"
  | "state"
  | "pincode"
  | "serviceCities"
  | "pan"
  | "gstin"
  | "reraNumber"
  | "reraValidTill";

export type ProfileValues = {
  [K in ProfileKey]: K extends "type"
    ? BuilderType | null
    : K extends "serviceCities"
      ? string[]
      : K extends "reraValidTill"
        ? Date | null
        : K extends "yearEstablished" | "projectsCompleted" | "projectsOngoing"
          ? number | null
          : string | null;
};

export type ProfileUpdates = Pick<Prisma.BuilderUpdateInput, ProfileKey>;

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

type FieldDef = {
  label: string;
  /** Needed before the profile can be submitted for verification. */
  required: boolean;
  /** Legal identity. Locked once verified: changing it would make the badge meaningless. */
  legal: boolean;
  parse: (raw: string) => ParseResult;
};

const fail = (error: string): ParseResult => ({ ok: false, error });
const ok = (value: unknown): ParseResult => ({ ok: true, value });

function text(label: string, min: number, max: number): (raw: string) => ParseResult {
  return (raw) => {
    if (raw.length < min) return fail(`${label} must be at least ${min} characters.`);
    if (raw.length > max) return fail(`${label} must be at most ${max} characters.`);
    return ok(raw);
  };
}

function integer(label: string, min: number, max: () => number): (raw: string) => ParseResult {
  return (raw) => {
    if (!/^\d{1,5}$/.test(raw)) return fail(`${label} must be a whole number.`);
    const value = Number(raw);
    if (value < min || value > max()) return fail(`${label} must be between ${min} and ${max()}.`);
    return ok(value);
  };
}

function mobile(label: string): (raw: string) => ParseResult {
  return (raw) => {
    const value = normalizeMobile(raw);
    return value ? ok(value) : fail(`Enter a valid 10 digit Indian mobile number for ${label}.`);
  };
}

function website(raw: string): ParseResult {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".") || candidate.length > 200) throw new Error("bad host");
    return ok(url.toString().replace(/\/$/, ""));
  } catch {
    return fail("Enter a valid website address, for example www.yourcompany.com.");
  }
}

function cities(raw: string): ParseResult {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const city = part.trim().replace(/\s+/g, " ");
    if (!city || seen.has(city.toLowerCase())) continue;
    if (city.length < 2 || city.length > 60) return fail("Each city must be 2 to 60 characters.");
    seen.add(city.toLowerCase());
    list.push(city);
  }
  if (list.length > 10) return fail("List at most 10 cities.");
  return ok(list);
}

function isoDate(raw: string): ParseResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail("Enter a valid date.");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    return fail("Enter a valid date.");
  }
  return ok(date);
}

const thisYear = () => new Date().getFullYear();

export const PROFILE_FIELDS: Record<ProfileKey, FieldDef> = {
  companyName: {
    label: "Company name",
    required: true,
    legal: true,
    parse: text("Company name", 2, 120),
  },
  type: {
    label: "Type of business",
    required: true,
    legal: true,
    parse: (raw) =>
      BUILDER_TYPES.some((t) => t.value === raw) ? ok(raw) : fail("Choose a type of business."),
  },
  yearEstablished: {
    label: "Year established",
    required: true,
    legal: true,
    parse: integer("Year established", 1900, thisYear),
  },
  projectsCompleted: {
    label: "Projects completed",
    required: false,
    legal: false,
    parse: integer("Projects completed", 0, () => 10000),
  },
  projectsOngoing: {
    label: "Projects ongoing",
    required: false,
    legal: false,
    parse: integer("Projects ongoing", 0, () => 10000),
  },
  about: {
    label: "About your company",
    required: false,
    legal: false,
    parse: text("About", 0, 500),
  },
  website: { label: "Website", required: false, legal: false, parse: website },
  contactPerson: {
    label: "Contact person",
    required: true,
    legal: false,
    parse: text("Contact person", 2, 80),
  },
  contactMobile: {
    label: "Contact mobile",
    required: true,
    legal: false,
    parse: mobile("the contact mobile"),
  },
  whatsapp: { label: "WhatsApp number", required: false, legal: false, parse: mobile("WhatsApp") },
  addressLine: {
    label: "Office address",
    required: true,
    legal: true,
    parse: text("Office address", 5, 200),
  },
  city: { label: "City", required: true, legal: true, parse: text("City", 2, 60) },
  state: {
    label: "State",
    required: true,
    legal: true,
    parse: (raw) => (INDIAN_STATES.includes(raw) ? ok(raw) : fail("Choose a state.")),
  },
  pincode: {
    label: "PIN code",
    required: true,
    legal: true,
    parse: (raw) =>
      isValidPincode(raw) ? ok(raw.trim()) : fail("Enter a valid 6 digit PIN code."),
  },
  serviceCities: { label: "Cities you build in", required: false, legal: false, parse: cities },
  pan: {
    label: "PAN",
    required: true,
    legal: true,
    parse: (raw) =>
      isValidPan(raw) ? ok(normalizePan(raw)) : fail("Enter a valid PAN, for example ABCDE1234F."),
  },
  gstin: {
    label: "GSTIN",
    required: true,
    legal: true,
    parse: (raw) =>
      isValidGstin(raw)
        ? ok(normalizeGstin(raw))
        : fail("Enter a valid 15 character GSTIN. Check each character."),
  },
  reraNumber: {
    label: "RERA registration number",
    required: false,
    legal: true,
    parse: (raw) =>
      /^[A-Za-z0-9/\-. ]{5,40}$/.test(raw)
        ? ok(raw.toUpperCase())
        : fail("Enter a valid RERA registration number."),
  },
  reraValidTill: { label: "RERA valid until", required: false, legal: true, parse: isoDate },
};

export const PROFILE_KEYS = Object.keys(PROFILE_FIELDS) as ProfileKey[];

export type ProfileParseResult = {
  /** Valid changes, ready to save. */
  updates: Record<string, unknown>;
  /** Field key to message, for values that were rejected and not saved. */
  errors: Record<string, string>;
};

/**
 * Validates submitted values one field at a time. Valid fields are returned for saving even if
 * others are wrong, so autosave keeps what is good and only complains about the rest.
 * An empty value clears the field.
 */
export function parseProfileInput(
  input: Record<string, string | undefined>,
  mode: EditMode,
): ProfileParseResult {
  const updates: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!(key in PROFILE_FIELDS) || raw === undefined) continue;
    const field = PROFILE_FIELDS[key as ProfileKey];

    if (mode === "locked") {
      errors[key] = "This can't be edited while your application is in this state.";
      continue;
    }
    if (mode === "presentation" && field.legal) {
      errors[key] = "Verified details can't be changed here. Contact support to update them.";
      continue;
    }

    const value = raw.trim();
    if (value === "") {
      updates[key] = key === "serviceCities" ? [] : null;
      continue;
    }
    const result = field.parse(value);
    if (result.ok) updates[key] = result.value;
    else errors[key] = result.error;
  }

  return { updates, errors };
}

// ---------- completeness ----------

export type ProfileSnapshot = Pick<ProfileValues, ProfileKey> & {
  interestedPlan: string | null;
};

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export const REQUIRED_PROFILE_KEYS = PROFILE_KEYS.filter((key) => PROFILE_FIELDS[key].required);

export function missingProfileFields(
  profile: ProfileSnapshot,
): { key: ProfileKey; label: string }[] {
  return REQUIRED_PROFILE_KEYS.filter((key) => !isFilled(profile[key])).map((key) => ({
    key,
    label: PROFILE_FIELDS[key].label,
  }));
}

/** Problems that involve more than one field, found only when submitting. */
export function crossFieldProblems(profile: ProfileSnapshot): string[] {
  const problems: string[] = [];
  if (profile.pan && profile.gstin && isValidPan(profile.pan) && isValidGstin(profile.gstin)) {
    if (panFromGstin(profile.gstin) !== normalizePan(profile.pan)) {
      problems.push("The PAN inside your GSTIN does not match the PAN you entered.");
    }
  }
  if (profile.reraValidTill && profile.reraValidTill.getTime() < Date.now()) {
    problems.push("Your RERA registration has expired. Update the date or remove it.");
  }
  return problems;
}

export type DocumentSummary = { kind: DocumentKind; status: DocumentStatus };

export type Checklist = {
  profile: { done: boolean; missing: { key: ProfileKey; label: string }[]; problems: string[] };
  documents: { done: boolean; missing: DocumentKind[]; rejected: DocumentKind[] };
  plan: { done: boolean };
  percent: number;
  canSubmit: boolean;
};

export function buildChecklist(profile: ProfileSnapshot, documents: DocumentSummary[]): Checklist {
  const missing = missingProfileFields(profile);
  const problems = crossFieldProblems(profile);

  const have = new Set(documents.map((d) => d.kind));
  const missingDocs = REQUIRED_DOCUMENT_KINDS.filter((kind) => !have.has(kind));
  const rejected = documents.filter((d) => d.status === "REJECTED").map((d) => d.kind);
  const planDone = Boolean(profile.interestedPlan);

  const total = REQUIRED_PROFILE_KEYS.length + REQUIRED_DOCUMENT_KINDS.length + 1;
  const complete =
    REQUIRED_PROFILE_KEYS.length -
    missing.length +
    (REQUIRED_DOCUMENT_KINDS.length - missingDocs.length) +
    (planDone ? 1 : 0);

  const profileDone = missing.length === 0 && problems.length === 0;
  const documentsDone = missingDocs.length === 0 && rejected.length === 0;

  return {
    profile: { done: profileDone, missing, problems },
    documents: { done: documentsDone, missing: missingDocs, rejected },
    plan: { done: planDone },
    percent: Math.round((complete / total) * 100),
    canSubmit: profileDone && documentsDone && planDone,
  };
}

// ---------- form helpers ----------

export type ProfileFormValues = Record<ProfileKey, string>;

/** Stored profile to the plain strings an HTML form shows. */
export function profileToFormValues(profile: ProfileSnapshot): ProfileFormValues {
  const values = {} as ProfileFormValues;
  for (const key of PROFILE_KEYS) {
    const value = profile[key];
    if (value === null || value === undefined) values[key] = "";
    else if (value instanceof Date) values[key] = value.toISOString().slice(0, 10);
    else if (Array.isArray(value)) values[key] = value.join(", ");
    else values[key] = String(value);
  }
  return values;
}
