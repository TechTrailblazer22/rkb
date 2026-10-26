import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SPECS,
  REQUIRED_DOCUMENT_KINDS,
  unapprovedForVerification,
} from "@/lib/builders/documents";

describe("documents are optional", () => {
  it("requires none of them", () => {
    expect(REQUIRED_DOCUMENT_KINDS).toEqual([]);
    expect(DOCUMENT_SPECS.every((spec) => !spec.required)).toBe(true);
  });
});

describe("unapprovedForVerification", () => {
  it("has nothing in the way when nothing was uploaded", () => {
    expect(unapprovedForVerification([])).toEqual([]);
  });

  it("holds back an uploaded document that is still pending or was sent back", () => {
    const docs = [
      { kind: "PAN" as const, status: "PENDING" },
      { kind: "GST" as const, status: "REJECTED" },
      { kind: "BUSINESS_PROOF" as const, status: "APPROVED" },
    ];
    expect(unapprovedForVerification(docs).sort()).toEqual(["GST", "PAN"]);
  });

  it("has nothing in the way once everything uploaded is approved", () => {
    expect(unapprovedForVerification([{ kind: "PAN", status: "APPROVED" }])).toEqual([]);
  });
});
