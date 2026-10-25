import { describe, expect, it } from "vitest";
import type { BuilderStatus } from "@/generated/prisma/enums";
import { editMode, nextStatus, type BuilderAction } from "@/lib/builders/status";

const ALL: BuilderStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
];

describe("nextStatus", () => {
  it("walks the happy path: draft, review, verified", () => {
    expect(nextStatus("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(nextStatus("SUBMITTED", "APPROVE")).toBe("VERIFIED");
  });

  it("supports a round of changes before approval", () => {
    expect(nextStatus("SUBMITTED", "REQUEST_CHANGES")).toBe("CHANGES_REQUESTED");
    expect(nextStatus("CHANGES_REQUESTED", "SUBMIT")).toBe("SUBMITTED");
  });

  it("only approves what is under review", () => {
    for (const status of ALL.filter((s) => s !== "SUBMITTED")) {
      expect(nextStatus(status, "APPROVE")).toBeNull();
    }
  });

  it("cannot skip review: a draft can only be submitted", () => {
    const blocked: BuilderAction[] = [
      "APPROVE",
      "REQUEST_CHANGES",
      "REJECT",
      "SUSPEND",
      "REINSTATE",
    ];
    for (const action of blocked) expect(nextStatus("DRAFT", action)).toBeNull();
  });

  it("can reject during review or while changes are pending", () => {
    expect(nextStatus("SUBMITTED", "REJECT")).toBe("REJECTED");
    expect(nextStatus("CHANGES_REQUESTED", "REJECT")).toBe("REJECTED");
    expect(nextStatus("VERIFIED", "REJECT")).toBeNull();
  });

  it("suspends and reinstates only verified builders", () => {
    expect(nextStatus("VERIFIED", "SUSPEND")).toBe("SUSPENDED");
    expect(nextStatus("SUSPENDED", "REINSTATE")).toBe("VERIFIED");
    expect(nextStatus("DRAFT", "SUSPEND")).toBeNull();
    expect(nextStatus("VERIFIED", "REINSTATE")).toBeNull();
  });

  it("treats a rejected builder as final", () => {
    for (const action of ["SUBMIT", "APPROVE", "REINSTATE"] as BuilderAction[]) {
      expect(nextStatus("REJECTED", action)).toBeNull();
    }
  });
});

describe("editMode", () => {
  it("allows full edits before submission and after a change request", () => {
    expect(editMode("DRAFT")).toBe("full");
    expect(editMode("CHANGES_REQUESTED")).toBe("full");
  });

  it("limits verified builders to presentation fields", () => {
    expect(editMode("VERIFIED")).toBe("presentation");
  });

  it("locks everything while reviewing, and for rejected or suspended builders", () => {
    for (const status of ["SUBMITTED", "REJECTED", "SUSPENDED"] as BuilderStatus[]) {
      expect(editMode(status)).toBe("locked");
    }
  });
});
