import type { PrismaClient } from "@/generated/prisma/client";
import type { PlotStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { safePublicUrl } from "@/lib/storage/url";

// The interactive layout map: one rectangle per plot, over the layout image (or a plain grid).
// Rectangles are stored as percentages of the map's width and height, so the map looks the same at
// any size. Saving replaces the whole map in one transaction.

export const MAX_SHAPES = 1000;
const MIN_SIZE = 0.5;
const EDGE = 100.0001;

export type ShapeInput = { plotId: string; x: number; y: number; w: number; h: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A rectangle that lies inside the map and is not too small to tap, rounded to two decimals. */
export function normaliseShape(input: unknown): Omit<ShapeInput, "plotId"> | null {
  if (typeof input !== "object" || input === null) return null;
  const { x, y, w, h } = input as Record<string, unknown>;
  for (const value of [x, y, w, h]) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
  }
  const [rx, ry, rw, rh] = [x, y, w, h].map((v) => round2(v as number));
  if (rx < 0 || ry < 0 || rw < MIN_SIZE || rh < MIN_SIZE) return null;
  if (rx + rw > EDGE || ry + rh > EDGE) return null;
  return { x: rx, y: ry, w: rw, h: rh };
}

export type SaveResult = { ok: true; count: number } | { ok: false; message: string };

/** Replaces the project's map. Every plot must belong to the project and appear only once. */
export async function saveLayoutMap(
  db: PrismaClient,
  input: { projectId: string; builderId: string; shapes: unknown; actorId: string },
): Promise<SaveResult> {
  if (!Array.isArray(input.shapes)) return { ok: false, message: "The map could not be read." };
  if (input.shapes.length > MAX_SHAPES) {
    return { ok: false, message: `A map can have at most ${MAX_SHAPES} plots.` };
  }
  const clean: ShapeInput[] = [];
  const seen = new Set<string>();
  for (const raw of input.shapes) {
    const plotId = (raw as { plotId?: unknown } | null)?.plotId;
    const shape = normaliseShape(raw);
    if (typeof plotId !== "string" || !shape) {
      return { ok: false, message: "A plot's rectangle is outside the map or too small." };
    }
    if (seen.has(plotId)) return { ok: false, message: "A plot can have only one rectangle." };
    seen.add(plotId);
    clean.push({ plotId, ...shape });
  }

  return db.$transaction(async (tx): Promise<SaveResult> => {
    // The project must belong to this company (the caller found the builder from the login).
    const project = await tx.project.findFirst({
      where: { id: input.projectId, builderId: input.builderId },
      select: { id: true },
    });
    if (!project) return { ok: false, message: "That project was not found." };
    if (clean.length > 0) {
      const owned = await tx.plot.count({
        where: { projectId: project.id, id: { in: clean.map((s) => s.plotId) } },
      });
      if (owned !== clean.length) {
        return { ok: false, message: "A rectangle points to a plot that is not in this project." };
      }
    }
    await tx.layoutShape.deleteMany({ where: { projectId: project.id } });
    if (clean.length > 0) {
      await tx.layoutShape.createMany({
        data: clean.map((s) => ({ projectId: project.id, ...s })),
      });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "layout_map.saved",
      entity: "Project",
      entityId: project.id,
      meta: { shapes: clean.length },
    });
    return { ok: true, count: clean.length };
  });
}

export type MapPlot = {
  id: string;
  number: string;
  sizeSqft: number;
  price: number | null;
  facing: string | null;
  isCorner: boolean;
  /** What buyers see: a plot on hold counts as booked. */
  status: Exclude<PlotStatus, "HELD">;
};

export type LayoutMapData = {
  /** The layout image to draw over, when one was uploaded and is an image (not a PDF). */
  imageUrl: string | null;
  shapes: (Omit<ShapeInput, "plotId"> & { plot: MapPlot })[];
};

/** The uploaded layout plan to draw over, when it is an image (a PDF cannot be drawn over). */
export async function layoutImageUrl(db: PrismaClient, projectId: string): Promise<string | null> {
  const image = await db.projectMedia.findFirst({
    where: { projectId, kind: "LAYOUT", mimeType: { startsWith: "image/" } },
    orderBy: { createdAt: "asc" },
    select: { storageKey: true },
  });
  return image ? safePublicUrl(image.storageKey, 1400) : null;
}

/** The map as buyers see it, or null when there is none. */
export async function loadLayoutMap(
  db: PrismaClient,
  projectId: string,
): Promise<LayoutMapData | null> {
  const shapes = await db.layoutShape.findMany({
    where: { projectId },
    select: {
      x: true,
      y: true,
      w: true,
      h: true,
      plot: {
        select: {
          id: true,
          number: true,
          sizeSqft: true,
          price: true,
          facing: true,
          isCorner: true,
          status: true,
        },
      },
    },
    orderBy: { plot: { sortKey: "asc" } },
  });
  if (shapes.length === 0) return null;
  return {
    imageUrl: await layoutImageUrl(db, projectId),
    shapes: shapes.map((s) => ({
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      plot: {
        id: s.plot.id,
        number: s.plot.number,
        sizeSqft: s.plot.sizeSqft,
        price: s.plot.price,
        facing: s.plot.facing,
        isCorner: s.plot.isCorner,
        status: s.plot.status === "HELD" ? "BOOKED" : s.plot.status,
      },
    })),
  };
}
