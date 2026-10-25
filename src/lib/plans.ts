// Single source of truth for plan names, prices and features on the marketing pages.
// Phase 7 moves this into the database and enforces the limits; keep the shape stable.
// Prices are proposed launch prices in INR, excluding GST.

export type PlanCode = "STARTER" | "GROWTH" | "PREMIER";

export const GST_PERCENT = 18;
/** "Pay for 10 months, get 12." */
export const ANNUAL_PAID_MONTHS = 10;

export type Plan = {
  code: PlanCode;
  name: string;
  audience: string;
  priceMonthly: number;
  highlighted: boolean;
  features: string[];
};

export const plans: Plan[] = [
  {
    code: "STARTER",
    name: "Starter",
    audience: "Small builders",
    priceMonthly: 2999,
    highlighted: false,
    features: [
      "Up to 2 projects",
      "Plot-wise inventory",
      "Basic lead dashboard",
      "Online plot booking",
      "15 photos per project",
      "Verified Builder badge",
      "WhatsApp lead alerts",
      "Email support",
    ],
  },
  {
    code: "GROWTH",
    name: "Growth",
    audience: "Mid-size builders",
    priceMonthly: 7999,
    highlighted: true,
    features: [
      "Up to 6 projects",
      "Interactive layout map",
      "Full lead dashboard",
      "3 team users",
      "40 photos plus video",
      "Advanced analytics",
      "2 featured days per month",
      "Phone and email support",
    ],
  },
  {
    code: "PREMIER",
    name: "Premier",
    audience: "Large developers",
    priceMonthly: 19999,
    highlighted: false,
    features: [
      "Unlimited projects",
      "Priority search listing",
      "Homepage spotlight",
      "10 team users",
      "Video and 360° tour",
      "Analytics with export",
      "Dedicated account manager",
      "Everything in Growth",
    ],
  },
];

export function annualPrice(priceMonthly: number): number {
  return priceMonthly * ANNUAL_PAID_MONTHS;
}

/** What the annual plan saves compared with paying month by month for 12 months. */
export function annualSavings(priceMonthly: number): number {
  return priceMonthly * 12 - annualPrice(priceMonthly);
}

/** Annual price spread over 12 months, for comparing with the monthly price. */
export function effectiveMonthly(priceMonthly: number): number {
  return Math.round(annualPrice(priceMonthly) / 12);
}

// Comparison table. `true`/`false` render as a tick/dash; strings render as text.
// Where the proposal lists an item under one plan only (for example WhatsApp alerts and the
// Verified badge under Starter), higher plans are treated as including it.
export type Cell = string | boolean;
export type ComparisonRow = { label: string; values: [Cell, Cell, Cell] };

export const comparison: ComparisonRow[] = [
  { label: "Projects", values: ["Up to 2", "Up to 6", "Unlimited"] },
  { label: "Plot-wise inventory", values: [true, true, true] },
  { label: "Online plot booking", values: [true, true, true] },
  { label: "Verified Builder badge", values: [true, true, true] },
  { label: "WhatsApp lead alerts", values: [true, true, true] },
  { label: "Lead dashboard", values: ["Basic", "Full", "Full"] },
  { label: "Photos per project", values: ["15", "40", "40"] },
  { label: "Video", values: [false, true, true] },
  { label: "360° tour", values: [false, false, true] },
  { label: "Interactive layout map", values: [false, true, true] },
  { label: "Team users", values: ["1", "3", "10"] },
  { label: "Analytics", values: [false, "Advanced", "Advanced with export"] },
  { label: "Featured days", values: [false, "2 per month", "Priority listing"] },
  { label: "Homepage spotlight", values: [false, false, true] },
  { label: "Support", values: ["Email", "Phone and email", "Dedicated account manager"] },
];
