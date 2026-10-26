import type { PrismaClient } from "@/generated/prisma/client";
import type { ProjectStatus } from "@/generated/prisma/enums";

// The numbers on a builder's overview page. Everything comes from the database at the moment the
// page is opened; nothing is stored or estimated.

export type DashboardAttention = {
  id: string;
  name: string;
  status: ProjectStatus;
  /** The reviewer's note, for projects sent back or paused. */
  note: string | null;
};

export type BuilderDashboard = {
  projects: {
    /** Every project except archived ones. */
    total: number;
    live: number;
    inReview: number;
    draft: number;
    changesRequested: number;
    paused: number;
  };
  /** Plots in the builder's live projects only, which are the ones buyers can see. */
  plots: { total: number; available: number; booked: number; sold: number };
  /** Projects that are waiting on the builder or are not visible to buyers, most recent first. */
  attention: DashboardAttention[];
};

const ATTENTION: ProjectStatus[] = ["CHANGES_REQUESTED", "PAUSED"];

export async function loadBuilderDashboard(
  db: PrismaClient,
  builderId: string,
): Promise<BuilderDashboard> {
  const [byStatus, plotRows, attention] = await Promise.all([
    db.project.groupBy({
      by: ["status"],
      where: { builderId, status: { not: "ARCHIVED" } },
      _count: { _all: true },
    }),
    db.plot.groupBy({
      by: ["status"],
      where: { project: { builderId, status: "LIVE" } },
      _count: { _all: true },
    }),
    db.project.findMany({
      where: { builderId, status: { in: ATTENTION } },
      select: { id: true, name: true, status: true, reviewNote: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  const projectCount = (status: ProjectStatus) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const plotCount = (...statuses: string[]) =>
    plotRows
      .filter((row) => statuses.includes(row.status))
      .reduce((n, row) => n + row._count._all, 0);

  return {
    projects: {
      total: byStatus.reduce((n, row) => n + row._count._all, 0),
      live: projectCount("LIVE"),
      inReview: projectCount("SUBMITTED"),
      draft: projectCount("DRAFT"),
      changesRequested: projectCount("CHANGES_REQUESTED"),
      paused: projectCount("PAUSED"),
    },
    plots: {
      total: plotRows.reduce((n, row) => n + row._count._all, 0),
      available: plotCount("AVAILABLE"),
      // A plot on hold is shown to buyers as booked.
      booked: plotCount("BOOKED", "HELD"),
      sold: plotCount("SOLD"),
    },
    attention: attention.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      note: row.reviewNote,
    })),
  };
}
