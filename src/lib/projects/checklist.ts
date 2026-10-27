import type { ApprovalKind } from "@/generated/prisma/enums";
import type { StepSlug } from "@/lib/projects/fields";

// What makes a listing complete. Nothing is mandatory: a project can be submitted, and approved,
// at any level of completeness, and the score only tells the builder how far along it is. Set an
// item's `required` flag to true to make it a condition of submitting and approving again; the
// score then weighs required items three times as much. Contradictions between filled-in values
// ("problems" below) still block, because they are mistakes rather than missing information.

export const MIN_DESCRIPTION = 50;
export const MIN_PHOTOS = 3;
export const MIN_AMENITIES = 3;
const REQUIRED_WEIGHT = 3;

export type ChecklistProject = {
  name: string;
  city: string | null;
  locality: string | null;
  addressLine: string | null;
  mapUrl: string | null;
  description: string | null;
  acres: number | null;
  totalPlots: number | null;
  openAreaPercent: number | null;
  landUse: string | null;
  titleStatus: string | null;
  startDate: Date | null;
  completionDate: Date | null;
  percentComplete: number | null;
  pricePerSqft: number | null;
  budgetFrom: number | null;
  budgetTo: number | null;
  tokenAmount: number | null;
  paymentPlan: string | null;
  amenities: string[];
  videoUrl: string | null;
  tourUrl?: string | null;
  contactName: string | null;
  contactMobile: string | null;
  whatsapp: string | null;
  visitingHours: string | null;
};

export type ChecklistInput = {
  project: ChecklistProject;
  plotCount: number;
  pricedPlotCount: number;
  approvals: { kind: ApprovalKind; number: string | null; validTill: Date | null }[];
  photoCount: number;
  hasLayout: boolean;
  hasBrochure: boolean;
  /** Injected for tests; defaults to now. */
  now?: Date;
};

export type ChecklistItem = {
  key: string;
  step: StepSlug;
  label: string;
  required: boolean;
  done: boolean;
};

export type ProjectChecklist = {
  items: ChecklistItem[];
  /** Things that are filled in but contradict each other. They block submitting. */
  problems: { step: StepSlug; message: string }[];
  percent: number;
  canSubmit: boolean;
  missingRequired: ChecklistItem[];
  stepDone: Record<StepSlug, boolean>;
};

const filled = (value: string | null | undefined) => (value ?? "").trim().length > 0;

export function buildProjectChecklist(input: ChecklistInput): ProjectChecklist {
  const { project: p } = input;
  const today = input.now ?? new Date();
  const usableApprovals = input.approvals.filter(
    (a) => filled(a.number) && (!a.validTill || a.validTill.getTime() >= startOfDay(today)),
  );

  const item = (
    key: string,
    step: StepSlug,
    label: string,
    required: boolean,
    done: boolean,
  ): ChecklistItem => ({ key, step, label, required, done });

  const items: ChecklistItem[] = [
    item("name", "basics", "Project name", false, filled(p.name)),
    item("city", "basics", "City", false, filled(p.city)),
    item("locality", "basics", "Locality", false, filled(p.locality)),
    item("addressLine", "basics", "Site address", false, filled(p.addressLine)),
    item(
      "description",
      "basics",
      `Description (${MIN_DESCRIPTION} characters or more reads best)`,
      false,
      (p.description ?? "").trim().length >= MIN_DESCRIPTION,
    ),
    item("mapUrl", "basics", "Map link", false, filled(p.mapUrl)),

    item("totalPlots", "layout", "Total number of plots or units", false, p.totalPlots !== null),
    item("acres", "layout", "Project size in acres", false, p.acres !== null),
    item("openArea", "layout", "Open area percentage", false, p.openAreaPercent !== null),

    item("plots", "plots", "A plot or unit", false, input.plotCount > 0),

    item(
      "approval",
      "approvals",
      "An approval with its number (RERA, TNCP or municipal)",
      false,
      usableApprovals.length > 0,
    ),
    item("landUse", "approvals", "Land use", false, filled(p.landUse)),
    item("titleStatus", "approvals", "Title status", false, filled(p.titleStatus)),

    item("startDate", "timeline", "Start date", false, p.startDate !== null),
    item("completionDate", "timeline", "Expected completion", false, p.completionDate !== null),
    item("percentComplete", "timeline", "Percent complete", false, p.percentComplete !== null),

    item(
      "price",
      "pricing",
      "A price: either a price per sq ft or prices on your plots",
      false,
      p.pricePerSqft !== null || input.pricedPlotCount > 0,
    ),
    item("tokenAmount", "pricing", "Token amount", false, p.tokenAmount !== null),
    item("paymentPlan", "pricing", "Payment plan", false, filled(p.paymentPlan)),

    item(
      "amenities",
      "amenities",
      `Amenities (${MIN_AMENITIES} or more look best)`,
      false,
      p.amenities.length >= MIN_AMENITIES,
    ),

    item(
      "photos",
      "media",
      `Photos (${MIN_PHOTOS} or more look best)`,
      false,
      input.photoCount >= MIN_PHOTOS,
    ),
    item("layout", "media", "Layout plan", false, input.hasLayout),
    item("brochure", "media", "Brochure", false, input.hasBrochure),
    item("video", "media", "Video", false, filled(p.videoUrl)),

    item("contactName", "contact", "Contact person", false, filled(p.contactName)),
    item("contactMobile", "contact", "Contact mobile", false, filled(p.contactMobile)),
    item("whatsapp", "contact", "WhatsApp number", false, filled(p.whatsapp)),
    item("visitingHours", "contact", "Site visiting hours", false, filled(p.visitingHours)),
  ];

  const problems: ProjectChecklist["problems"] = [];
  if (p.budgetFrom !== null && p.budgetTo !== null && p.budgetFrom > p.budgetTo) {
    problems.push({
      step: "pricing",
      message: "The starting price is higher than the highest price.",
    });
  }
  if (p.startDate && p.completionDate && p.completionDate < p.startDate) {
    problems.push({ step: "timeline", message: "The completion date is before the start date." });
  }
  if (p.totalPlots !== null && input.plotCount > p.totalPlots) {
    problems.push({
      step: "plots",
      message: `You have added ${input.plotCount} plots but the total says ${p.totalPlots}. Raise the total or remove plots.`,
    });
  }
  for (const approval of input.approvals) {
    if (approval.validTill && approval.validTill.getTime() < startOfDay(today)) {
      problems.push({
        step: "approvals",
        message: `The ${approval.kind} approval has expired. Update it or remove it.`,
      });
    }
  }

  const total = items.reduce((sum, i) => sum + (i.required ? REQUIRED_WEIGHT : 1), 0);
  const earned = items.reduce(
    (sum, i) => sum + (i.done ? (i.required ? REQUIRED_WEIGHT : 1) : 0),
    0,
  );
  const missingRequired = items.filter((i) => i.required && !i.done);
  const canSubmit = missingRequired.length === 0 && problems.length === 0;

  const stepDone = {} as Record<StepSlug, boolean>;
  for (const slug of [
    "basics",
    "layout",
    "plots",
    "approvals",
    "timeline",
    "pricing",
    "amenities",
    "media",
    "contact",
  ] as StepSlug[]) {
    const inStep = items.filter((i) => i.step === slug);
    const required = inStep.filter((i) => i.required);
    const stepProblems = problems.some((pr) => pr.step === slug);
    stepDone[slug] =
      !stepProblems &&
      (required.length > 0 ? required.every((i) => i.done) : inStep.some((i) => i.done));
  }
  stepDone.review = canSubmit;

  return {
    items,
    problems,
    percent: Math.round((earned / total) * 100),
    canSubmit,
    missingRequired,
    stepDone,
  };
}

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
