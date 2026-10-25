import { describe, expect, it } from "vitest";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { entitlementsFor, entitlementsForBuilder } from "@/lib/entitlements";
import {
  mayPerform,
  nextProjectStatus,
  projectEditMode,
  type ProjectAction,
} from "@/lib/projects/status";
import { parseYouTubeId, youTubeEmbedUrl, youTubeWatchUrl } from "@/lib/projects/video";

const ALL: ProjectStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "LIVE",
  "PAUSED",
  "ARCHIVED",
];

describe("project status machine", () => {
  it("goes draft, review, live", () => {
    expect(nextProjectStatus("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(nextProjectStatus("SUBMITTED", "APPROVE")).toBe("LIVE");
  });

  it("supports a round of changes", () => {
    expect(nextProjectStatus("SUBMITTED", "REQUEST_CHANGES")).toBe("CHANGES_REQUESTED");
    expect(nextProjectStatus("CHANGES_REQUESTED", "SUBMIT")).toBe("SUBMITTED");
  });

  it("only approves what is under review", () => {
    for (const status of ALL.filter((s) => s !== "SUBMITTED")) {
      expect(nextProjectStatus(status, "APPROVE")).toBeNull();
    }
  });

  it("a draft cannot skip review", () => {
    const blocked: ProjectAction[] = ["APPROVE", "REQUEST_CHANGES", "PAUSE", "RESUME", "REOPEN"];
    for (const action of blocked) expect(nextProjectStatus("DRAFT", action)).toBeNull();
  });

  it("pauses and resumes live listings", () => {
    expect(nextProjectStatus("LIVE", "PAUSE")).toBe("PAUSED");
    expect(nextProjectStatus("PAUSED", "RESUME")).toBe("LIVE");
    expect(nextProjectStatus("DRAFT", "PAUSE")).toBeNull();
  });

  it("reopening takes a live listing offline for changes", () => {
    expect(nextProjectStatus("LIVE", "REOPEN")).toBe("CHANGES_REQUESTED");
    expect(nextProjectStatus("DRAFT", "REOPEN")).toBeNull();
  });

  it("archived is final", () => {
    for (const action of ["SUBMIT", "APPROVE", "RESUME", "REOPEN", "ARCHIVE"] as ProjectAction[]) {
      expect(nextProjectStatus("ARCHIVED", action)).toBeNull();
    }
  });

  it("builders and admins can only do their own actions", () => {
    expect(mayPerform("SUBMIT", "builder")).toBe(true);
    expect(mayPerform("SUBMIT", "admin")).toBe(false);
    expect(mayPerform("APPROVE", "builder")).toBe(false);
    expect(mayPerform("APPROVE", "admin")).toBe(true);
    expect(mayPerform("PAUSE", "builder")).toBe(false);
    expect(mayPerform("REOPEN", "builder")).toBe(true);
    expect(mayPerform("ARCHIVE", "builder")).toBe(true);
    expect(mayPerform("ARCHIVE", "admin")).toBe(true);
  });

  it("maps statuses to edit rights", () => {
    expect(projectEditMode("DRAFT")).toBe("full");
    expect(projectEditMode("CHANGES_REQUESTED")).toBe("full");
    expect(projectEditMode("LIVE")).toBe("cosmetic");
    for (const status of ["SUBMITTED", "PAUSED", "ARCHIVED"] as ProjectStatus[]) {
      expect(projectEditMode(status)).toBe("locked");
    }
  });
});

describe("parseYouTubeId", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "http://youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ])("finds the id in %s", (url) => {
    expect(parseYouTubeId(url)).toBe("dQw4w9WgXcQ");
  });

  it.each([
    "https://vimeo.com/12345",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
    "not a link",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });

  it("builds the watch and privacy-friendly embed addresses", () => {
    expect(youTubeWatchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});

describe("entitlements", () => {
  it("follows the proposal's plan table", () => {
    expect(entitlementsFor("STARTER")).toEqual({
      maxProjects: 2,
      maxPhotosPerProject: 15,
      video: false,
    });
    expect(entitlementsFor("GROWTH")).toEqual({
      maxProjects: 6,
      maxPhotosPerProject: 40,
      video: true,
    });
    expect(entitlementsFor("PREMIER").maxProjects).toBeNull();
  });

  it("gives everyone Growth limits until billing exists, whatever plan they said they wanted", () => {
    expect(entitlementsForBuilder({ interestedPlan: "STARTER" })).toEqual(
      entitlementsFor("GROWTH"),
    );
    expect(entitlementsForBuilder({ interestedPlan: null })).toEqual(entitlementsFor("GROWTH"));
  });
});
