import type { FormStep, ProjectFieldKey } from "@/lib/projects/fields";
import { LAND_USES, PROJECT_STAGES, PROJECT_TYPES, TITLE_STATUSES } from "@/lib/projects/fields";

// How each wizard step looks. The rules (what is valid, what is required, what locks) live in
// lib/projects/fields.ts; this file only says which control to draw for each field.

export type Control =
  | {
      kind: "text";
      inputMode?: "numeric" | "url" | "tel" | "decimal";
      placeholder?: string;
      maxLength?: number;
    }
  | { kind: "textarea"; rows: number; maxLength?: number }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "date" }
  | { kind: "amenities" };

export type FieldUi = {
  key: ProjectFieldKey;
  control: Control;
  hint?: string;
  wide?: boolean;
  /** Shown with a red star. Mirrors the checklist's required items (currently only the name, which a project cannot exist without). */
  required?: boolean;
};

export type StepUi = { title: string; description?: string; fields: FieldUi[] };

const strings = (values: string[]) => values.map((value) => ({ value, label: value }));

export const STEP_UI: Record<FormStep, StepUi> = {
  basics: {
    title: "Basics",
    description: "What the project is and where it is.",
    fields: [
      { key: "name", control: { kind: "text", maxLength: 100 }, required: true, wide: true },
      { key: "type", control: { kind: "select", options: PROJECT_TYPES } },
      { key: "stage", control: { kind: "select", options: PROJECT_STAGES } },
      { key: "city", control: { kind: "text", maxLength: 60 }, required: false },
      { key: "locality", control: { kind: "text", maxLength: 80 }, required: false },
      {
        key: "addressLine",
        control: { kind: "text", maxLength: 200 },
        required: false,
        wide: true,
      },
      {
        key: "mapUrl",
        control: {
          kind: "text",
          inputMode: "url",
          placeholder: "https://maps.google.com/...",
          maxLength: 300,
        },
        hint: "Open your site in Google Maps, choose Share, and paste the link.",
        wide: true,
      },
      {
        key: "description",
        control: { kind: "textarea", rows: 6, maxLength: 1500 },
        hint: "At least 50 characters. What makes this project worth a visit? Approvals, location, nearby facilities.",
        required: false,
        wide: true,
      },
    ],
  },
  layout: {
    title: "Size and layout",
    description: "How big the project is. The plots themselves are added in the next step.",
    fields: [
      {
        key: "acres",
        control: { kind: "text", inputMode: "decimal", placeholder: "For example 12.5" },
      },
      {
        key: "totalPlots",
        control: { kind: "text", inputMode: "numeric", maxLength: 4 },
        hint: "The planned total, even if you have not added every plot yet.",
        required: false,
      },
      { key: "openAreaPercent", control: { kind: "text", inputMode: "numeric", maxLength: 3 } },
      { key: "phasesCount", control: { kind: "text", inputMode: "numeric", maxLength: 2 } },
    ],
  },
  approvals: {
    title: "Legal and approvals",
    description:
      "Approvals and land details buyers and banks look for. Add the approval certificates below.",
    fields: [
      { key: "landUse", control: { kind: "select", options: strings(LAND_USES) }, required: false },
      {
        key: "titleStatus",
        control: { kind: "select", options: strings(TITLE_STATUSES) },
        required: false,
      },
      {
        key: "bankLoans",
        control: { kind: "textarea", rows: 2 },
        hint: "Banks that give loans for this project, separated by commas.",
        wide: true,
      },
    ],
  },
  timeline: {
    title: "Timeline and status",
    description: "Where the project stands.",
    fields: [
      { key: "startDate", control: { kind: "date" } },
      { key: "completionDate", control: { kind: "date" } },
      { key: "percentComplete", control: { kind: "text", inputMode: "numeric", maxLength: 3 } },
    ],
  },
  pricing: {
    title: "Pricing",
    description: "Prices are in rupees. Plot-wise prices are set in the Plots step.",
    fields: [
      {
        key: "pricePerSqft",
        control: { kind: "text", inputMode: "numeric", placeholder: "For example 1850" },
        hint: "Leave empty if every plot has its own price.",
      },
      { key: "tokenAmount", control: { kind: "text", inputMode: "numeric" } },
      {
        key: "budgetFrom",
        control: { kind: "text", inputMode: "numeric" },
        hint: "Leave empty to use the lowest plot price.",
      },
      {
        key: "budgetTo",
        control: { kind: "text", inputMode: "numeric" },
        hint: "Leave empty to use the highest plot price.",
      },
      { key: "paymentPlan", control: { kind: "textarea", rows: 3, maxLength: 1000 }, wide: true },
      {
        key: "additionalCharges",
        control: { kind: "textarea", rows: 3, maxLength: 1000 },
        hint: "Registration, development, maintenance and so on.",
        wide: true,
      },
      { key: "offers", control: { kind: "textarea", rows: 2, maxLength: 1000 }, wide: true },
    ],
  },
  amenities: {
    title: "Amenities",
    description: "Tick everything the project offers. Three or more helps buyers decide.",
    fields: [{ key: "amenities", control: { kind: "amenities" }, wide: true }],
  },
  media: {
    title: "Photos and media",
    description: "Photos are what buyers look at first.",
    fields: [
      {
        key: "videoUrl",
        control: { kind: "text", inputMode: "url", placeholder: "https://youtu.be/..." },
        hint: "A YouTube link. Available on the Growth plan and above.",
        wide: true,
      },
    ],
  },
  contact: {
    title: "Contact",
    description: "Who buyers reach when they enquire about this project.",
    fields: [
      { key: "contactName", control: { kind: "text", maxLength: 80 }, required: false },
      {
        key: "contactMobile",
        control: { kind: "text", inputMode: "tel", maxLength: 16 },
        required: false,
      },
      { key: "whatsapp", control: { kind: "text", inputMode: "tel", maxLength: 16 } },
      {
        key: "visitingHours",
        control: {
          kind: "text",
          placeholder: "For example 9 am to 6 pm, all days",
          maxLength: 100,
        },
      },
      {
        key: "hideContactNumber",
        control: {
          kind: "select",
          options: [
            { value: "show", label: "Show my number to buyers" },
            { value: "hide", label: "Hide it, buyers contact me through RKB" },
          ],
        },
        wide: true,
      },
    ],
  },
};
