import type { BuilderStatus } from "@/generated/prisma/enums";

// The only place that decides which status changes are legal. Every server action that
// changes Builder.status goes through nextStatus(), so the UI cannot skip a step.

export type BuilderAction =
  "SUBMIT" | "REQUEST_CHANGES" | "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE";

const TRANSITIONS: Record<BuilderAction, { from: BuilderStatus[]; to: BuilderStatus }> = {
  SUBMIT: { from: ["DRAFT", "CHANGES_REQUESTED"], to: "SUBMITTED" },
  REQUEST_CHANGES: { from: ["SUBMITTED"], to: "CHANGES_REQUESTED" },
  APPROVE: { from: ["SUBMITTED"], to: "VERIFIED" },
  REJECT: { from: ["SUBMITTED", "CHANGES_REQUESTED"], to: "REJECTED" },
  SUSPEND: { from: ["VERIFIED"], to: "SUSPENDED" },
  REINSTATE: { from: ["SUSPENDED"], to: "VERIFIED" },
};

/** The new status, or null when the action is not allowed from the current status. */
export function nextStatus(current: BuilderStatus, action: BuilderAction): BuilderStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

/**
 * What the builder may edit:
 * - full: everything (not yet submitted, or the reviewer asked for changes)
 * - presentation: only how the company is presented (verified builders), because changing
 *   legal identity after verification would make the badge meaningless
 * - locked: nothing (under review, rejected or suspended)
 */
export type EditMode = "full" | "presentation" | "locked";

export function editMode(status: BuilderStatus): EditMode {
  switch (status) {
    case "DRAFT":
    case "CHANGES_REQUESTED":
      return "full";
    case "VERIFIED":
      return "presentation";
    default:
      return "locked";
  }
}

export const statusLabel: Record<BuilderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Under review",
  CHANGES_REQUESTED: "Changes requested",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};
