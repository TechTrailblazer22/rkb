import type { LeadStatus, VisitStatus } from "@/generated/prisma/enums";

// The pipeline a builder moves an enquiry along, and the friendlier words the buyer sees for it.
// A lead may be moved to any status, because real sales do not go in a straight line.

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "SITE_VISIT",
  "NEGOTIATION",
  "BOOKED",
  "LOST",
];

export const leadStatusLabel: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_VISIT: "Site visit",
  NEGOTIATION: "Negotiation",
  BOOKED: "Booked",
  LOST: "Lost",
};

/** What the buyer sees. "Lost" is a builder's word, so the buyer sees "Closed". */
export const buyerStatusLabel: Record<LeadStatus, string> = {
  NEW: "Sent",
  CONTACTED: "The builder is in touch",
  SITE_VISIT: "Site visit planned",
  NEGOTIATION: "In discussion",
  BOOKED: "Booked",
  LOST: "Closed",
};

/** Statuses a builder is still working on: the ones that should nag when a follow-up is due. */
export const OPEN_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "SITE_VISIT",
  "NEGOTIATION",
];

export function parseLeadStatus(value: unknown): LeadStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return LEAD_STATUSES.find((status) => status === raw) ?? null;
}

export const VISIT_STATUSES: readonly VisitStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "DONE",
  "CANCELLED",
];

export const visitStatusLabel: Record<VisitStatus, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export function parseVisitStatus(value: unknown): VisitStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return VISIT_STATUSES.find((status) => status === raw) ?? null;
}
