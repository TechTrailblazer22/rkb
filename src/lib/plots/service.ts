import type { PrismaClient } from "@/generated/prisma/client";
import type { PlotStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { MAX_PLOTS_PER_PROJECT } from "@/lib/plots/import";
import type { PlotInput } from "@/lib/plots/row";
import { plotSortKey } from "@/lib/plots/sort";
import type { ServiceError } from "@/lib/projects/service";

const fail = (message: string): ServiceError => ({ ok: false, code: "invalid", message });

export type PlotVia = "manual" | "bulk" | "import" | "series";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

const toData = (plot: PlotInput) => ({
  number: plot.number,
  sortKey: plotSortKey(plot.number),
  sizeSqft: plot.sizeSqft,
  dimensions: plot.dimensions,
  facing: plot.facing,
  isCorner: plot.isCorner,
  roadWidthFt: plot.roadWidthFt,
  ratePerSqft: plot.ratePerSqft,
  price: plot.price,
  status: plot.status,
  phase: plot.phase,
  unitType: plot.unitType,
  builtUpSqft: plot.builtUpSqft,
});

/**
 * Adds plots in one transaction: all of them or none. Plot numbers must be new to the project,
 * compared ignoring case. Each new plot's starting status is written to the status log.
 */
export async function addPlots(
  db: PrismaClient,
  input: { projectId: string; actorId: string; plots: PlotInput[]; via: PlotVia },
): Promise<{ ok: true; created: number } | ServiceError> {
  const { projectId, actorId, plots, via } = input;
  if (plots.length === 0) return fail("There are no plots to add.");

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.plot.findMany({ where: { projectId }, select: { number: true } });
      if (existing.length + plots.length > MAX_PLOTS_PER_PROJECT) {
        return fail(`A project can hold at most ${MAX_PLOTS_PER_PROJECT} plots.`);
      }

      const taken = new Set(existing.map((p) => p.number.toLowerCase()));
      const clashes = plots.filter((p) => taken.has(p.number.toLowerCase())).map((p) => p.number);
      if (clashes.length > 0) {
        const shown = clashes.slice(0, 5).join(", ");
        return fail(
          `These plot numbers already exist: ${shown}${clashes.length > 5 ? " and more" : ""}.`,
        );
      }

      const created = await tx.plot.createManyAndReturn({
        data: plots.map((plot) => ({ projectId, ...toData(plot) })),
        select: { id: true, number: true, status: true },
      });
      await tx.plotStatusLog.createMany({
        data: created.map((plot) => ({
          plotId: plot.id,
          plotNumber: plot.number,
          projectId,
          fromStatus: null,
          toStatus: plot.status,
          actorId,
          via,
        })),
      });
      return { ok: true as const, created: created.length };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      return fail("Some of those plot numbers were just added by someone else.");
    throw error;
  }
}

export async function updatePlot(
  db: PrismaClient,
  input: { projectId: string; plotId: string; plot: PlotInput; actorId: string },
): Promise<{ ok: true } | ServiceError> {
  const { projectId, plotId, plot, actorId } = input;
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.plot.findFirst({ where: { id: plotId, projectId } });
      if (!current) return fail("That plot no longer exists.");

      const clash = await tx.plot.findFirst({
        where: {
          projectId,
          id: { not: plotId },
          number: { equals: plot.number, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (clash) return fail(`Plot ${plot.number} already exists.`);

      // A plot that is mid-payment (held) keeps its status until that finishes.
      const status = current.status === "HELD" ? current.status : plot.status;
      await tx.plot.update({ where: { id: plotId }, data: { ...toData(plot), status } });
      if (status !== current.status) {
        await tx.plotStatusLog.create({
          data: {
            plotId,
            plotNumber: plot.number,
            projectId,
            fromStatus: current.status,
            toStatus: status,
            actorId,
            via: "manual",
          },
        });
      }
      return { ok: true as const };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(`Plot ${plot.number} already exists.`);
    throw error;
  }
}

/**
 * Sets the status of many plots at once and records each change. Plots already in that status
 * are left alone, and plots that are held for an online payment are never overridden.
 */
export async function setPlotStatuses(
  db: PrismaClient,
  input: {
    projectId: string;
    plotIds: string[];
    status: Exclude<PlotStatus, "HELD">;
    actorId: string;
    via: PlotVia;
  },
): Promise<{ changed: number; skipped: number }> {
  const { projectId, plotIds, status, actorId, via } = input;
  if (plotIds.length === 0) return { changed: 0, skipped: 0 };

  return db.$transaction(async (tx) => {
    const plots = await tx.plot.findMany({
      where: { projectId, id: { in: plotIds } },
      select: { id: true, number: true, status: true },
    });
    const changing = plots.filter((p) => p.status !== status && p.status !== "HELD");
    if (changing.length > 0) {
      await tx.plot.updateMany({
        where: { id: { in: changing.map((p) => p.id) } },
        data: { status },
      });
      await tx.plotStatusLog.createMany({
        data: changing.map((p) => ({
          plotId: p.id,
          plotNumber: p.number,
          projectId,
          fromStatus: p.status,
          toStatus: status,
          actorId,
          via,
        })),
      });
    }
    return { changed: changing.length, skipped: plots.length - changing.length };
  });
}

export async function deletePlots(
  db: PrismaClient,
  input: { projectId: string; plotIds: string[]; actorId: string },
): Promise<{ deleted: number }> {
  const { projectId, plotIds, actorId } = input;
  if (plotIds.length === 0) return { deleted: 0 };

  return db.$transaction(async (tx) => {
    const plots = await tx.plot.findMany({
      where: { projectId, id: { in: plotIds } },
      select: { id: true, number: true },
    });
    if (plots.length === 0) return { deleted: 0 };
    await tx.plot.deleteMany({ where: { id: { in: plots.map((p) => p.id) } } });
    await recordAudit(tx, {
      actorId,
      action: "plots.deleted",
      entity: "Project",
      entityId: projectId,
      meta: { count: plots.length, numbers: plots.slice(0, 20).map((p) => p.number) },
    });
    return { deleted: plots.length };
  });
}

export async function plotCountsByStatus(
  db: PrismaClient,
  projectId: string,
): Promise<Record<PlotStatus, number> & { total: number }> {
  const grouped = await db.plot.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts = { AVAILABLE: 0, HELD: 0, BOOKED: 0, SOLD: 0, total: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    counts.total += row._count._all;
  }
  return counts;
}
