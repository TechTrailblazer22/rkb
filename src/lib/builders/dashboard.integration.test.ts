import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { PlotStatus, ProjectStatus } from "@/generated/prisma/enums";
import { loadBuilderDashboard } from "@/lib/builders/dashboard";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md):
//   TEST_DATABASE_URL=postgresql://... npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("builder dashboard (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let otherBuilderId: string;

  beforeEach(async () => {
    await db.project.deleteMany();
    await db.builder.deleteMany();
    builderId = (await db.builder.create({ data: { companyName: "Mine", status: "VERIFIED" } })).id;
    otherBuilderId = (
      await db.builder.create({ data: { companyName: "Theirs", status: "VERIFIED" } })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function project(
    owner: string,
    name: string,
    status: ProjectStatus,
    plots: PlotStatus[] = [],
    reviewNote?: string,
  ) {
    const created = await db.project.create({
      data: { builderId: owner, name, type: "PLOTTED", status, reviewNote: reviewNote ?? null },
    });
    for (const [i, plotStatus] of plots.entries()) {
      await db.plot.create({
        data: {
          projectId: created.id,
          number: `A-${i + 1}`,
          sortKey: `a-${String(i + 1).padStart(8, "0")}`,
          sizeSqft: 1000,
          status: plotStatus,
        },
      });
    }
    return created;
  }

  it("is all zeros for a builder with nothing yet", async () => {
    const data = await loadBuilderDashboard(db, builderId);
    expect(data.projects).toEqual({
      total: 0,
      live: 0,
      inReview: 0,
      draft: 0,
      changesRequested: 0,
      paused: 0,
    });
    expect(data.plots).toEqual({ total: 0, available: 0, booked: 0, sold: 0 });
    expect(data.attention).toEqual([]);
  });

  it("counts projects by where they are, leaving archived ones out", async () => {
    await project(builderId, "Live one", "LIVE");
    await project(builderId, "Live two", "LIVE");
    await project(builderId, "In review", "SUBMITTED");
    await project(builderId, "Draft", "DRAFT");
    await project(builderId, "Sent back", "CHANGES_REQUESTED");
    await project(builderId, "Paused", "PAUSED");
    await project(builderId, "Gone", "ARCHIVED");
    const { projects } = await loadBuilderDashboard(db, builderId);
    expect(projects).toEqual({
      total: 6,
      live: 2,
      inReview: 1,
      draft: 1,
      changesRequested: 1,
      paused: 1,
    });
  });

  it("counts plots of live projects only, and shows held plots as booked", async () => {
    await project(builderId, "Live", "LIVE", ["AVAILABLE", "AVAILABLE", "BOOKED", "HELD", "SOLD"]);
    await project(builderId, "Not live", "DRAFT", ["AVAILABLE", "AVAILABLE", "AVAILABLE"]);
    const { plots } = await loadBuilderDashboard(db, builderId);
    expect(plots).toEqual({ total: 5, available: 2, booked: 2, sold: 1 });
  });

  it("never mixes in another builder's numbers", async () => {
    await project(otherBuilderId, "Not mine", "LIVE", ["AVAILABLE", "SOLD"]);
    await project(otherBuilderId, "Not mine either", "CHANGES_REQUESTED", [], "Fix it");
    const data = await loadBuilderDashboard(db, builderId);
    expect(data.projects.total).toBe(0);
    expect(data.plots.total).toBe(0);
    expect(data.attention).toEqual([]);
  });

  it("lists what is waiting on the builder, with the reviewer's note", async () => {
    await project(builderId, "Needs work", "CHANGES_REQUESTED", [], "Please add the layout plan.");
    await project(builderId, "Switched off", "PAUSED", [], "Approval is being renewed.");
    await project(builderId, "Fine", "LIVE");
    const { attention } = await loadBuilderDashboard(db, builderId);
    expect(attention.map((a) => a.name).sort()).toEqual(["Needs work", "Switched off"]);
    expect(attention.find((a) => a.name === "Needs work")).toMatchObject({
      status: "CHANGES_REQUESTED",
      note: "Please add the layout plan.",
    });
  });
});
