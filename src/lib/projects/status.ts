import type { ProjectStatus } from "@/generated/prisma/enums";

// The only place that decides which project status changes are legal.

export type ProjectAction =
  "SUBMIT" | "REQUEST_CHANGES" | "APPROVE" | "PAUSE" | "RESUME" | "REOPEN" | "ARCHIVE";

const TRANSITIONS: Record<ProjectAction, { from: ProjectStatus[]; to: ProjectStatus }> = {
  SUBMIT: { from: ["DRAFT", "CHANGES_REQUESTED"], to: "SUBMITTED" },
  REQUEST_CHANGES: { from: ["SUBMITTED"], to: "CHANGES_REQUESTED" },
  APPROVE: { from: ["SUBMITTED"], to: "LIVE" },
  PAUSE: { from: ["LIVE"], to: "PAUSED" },
  RESUME: { from: ["PAUSED"], to: "LIVE" },
  // The builder wants to change legal or identifying details of a live listing. It goes offline
  // until they submit it again and it is re-approved.
  REOPEN: { from: ["LIVE"], to: "CHANGES_REQUESTED" },
  ARCHIVE: { from: ["DRAFT", "CHANGES_REQUESTED", "LIVE", "PAUSED"], to: "ARCHIVED" },
};

export type Actor = "builder" | "admin";

const ALLOWED_ACTORS: Record<ProjectAction, Actor[]> = {
  SUBMIT: ["builder"],
  REQUEST_CHANGES: ["admin"],
  APPROVE: ["admin"],
  PAUSE: ["admin"],
  RESUME: ["admin"],
  REOPEN: ["builder"],
  ARCHIVE: ["builder", "admin"],
};

/** The new status, or null when the action is not allowed from the current status. */
export function nextProjectStatus(
  current: ProjectStatus,
  action: ProjectAction,
): ProjectStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

export function mayPerform(action: ProjectAction, actor: Actor): boolean {
  return ALLOWED_ACTORS[action].includes(actor);
}

/**
 * What the builder may edit:
 * - full: everything (draft, or changes requested)
 * - cosmetic: only fields that do not change what was verified (live listings)
 * - locked: nothing (under review, paused, archived)
 */
export type ProjectEditMode = "full" | "cosmetic" | "locked";

export function projectEditMode(status: ProjectStatus): ProjectEditMode {
  switch (status) {
    case "DRAFT":
    case "CHANGES_REQUESTED":
      return "full";
    case "LIVE":
      return "cosmetic";
    default:
      return "locked";
  }
}

export const projectStatusLabel: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Under review",
  CHANGES_REQUESTED: "Changes requested",
  LIVE: "Live",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};
