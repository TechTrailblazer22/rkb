import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadLayoutMap, normaliseShape, saveLayoutMap } from "@/lib/layout-map/service";

const url = process.env.TEST_DATABASE_URL;

describe("normaliseShape", () => {
  it("accepts a rectangle inside the map and rounds it", () => {
    expect(normaliseShape({ x: 10.123, y: 5, w: 20.456, h: 8 })).toEqual({
      x: 10.12,
      y: 5,
      w: 20.46,
      h: 8,
    });
    expect(normaliseShape({ x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
  it("refuses anything outside the map, too small, or not numbers", () => {
    for (const bad of [
      { x: -1, y: 0, w: 5, h: 5 },
      { x: 0, y: -0.1, w: 5, h: 5 },
      { x: 95, y: 0, w: 6, h: 5 },
      { x: 0, y: 99, w: 5, h: 2 },
      { x: 0, y: 0, w: 0.1, h: 5 },
      { x: 0, y: 0, w: 5, h: 0 },
      { x: "1", y: 0, w: 5, h: 5 },
      { x: NaN, y: 0, w: 5, h: 5 },
      { x: Infinity, y: 0, w: 5, h: 5 },
      null,
      "x",
      undefined,
    ]) {
      expect(normaliseShape(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe.skipIf(!url)("the layout map (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let projectId: string;
  let plotIds: string[];

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    builderId = (await db.builder.create({ data: { companyName: "Anand", status: "VERIFIED" } }))
      .id;
    projectId = (
      await db.project.create({
        data: { builderId, name: "GV", slug: "gv", type: "PLOTTED", status: "LIVE" },
      })
    ).id;
    plotIds = [];
    for (const [i, status] of (["AVAILABLE", "HELD", "SOLD"] as const).entries()) {
      plotIds.push(
        (
          await db.plot.create({
            data: {
              projectId,
              number: `A-${i + 1}`,
              sortKey: `a-0000000${i + 1}`,
              sizeSqft: 1000 + i,
              status,
            },
          })
        ).id,
      );
    }
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const save = (shapes: unknown, over: Record<string, unknown> = {}) =>
    saveLayoutMap(db, { projectId, builderId, shapes, actorId: "a", ...over } as Parameters<
      typeof saveLayoutMap
    >[1]);
  const rect = (plotId: string, x = 10) => ({ plotId, x, y: 10, w: 10, h: 10 });

  it("saves rectangles, and replaces them on the next save", async () => {
    expect(await save(plotIds.map((id, i) => rect(id, i * 20)))).toEqual({ ok: true, count: 3 });
    expect(await db.layoutShape.count({ where: { projectId } })).toBe(3);
    expect(await save([rect(plotIds[0], 50)])).toEqual({ ok: true, count: 1 });
    const shapes = await db.layoutShape.findMany({ where: { projectId } });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ plotId: plotIds[0], x: 50 });
    expect(await save([])).toEqual({ ok: true, count: 0 });
    expect(await db.layoutShape.count({ where: { projectId } })).toBe(0);
  });

  it("refuses a bad shape, a duplicate plot, and too many, saving nothing", async () => {
    await save([rect(plotIds[0])]);
    expect(await save([{ plotId: plotIds[1], x: 99, y: 0, w: 10, h: 10 }])).toMatchObject({
      ok: false,
    });
    expect(await save([rect(plotIds[1]), rect(plotIds[1], 30)])).toMatchObject({ ok: false });
    expect(await save(Array.from({ length: 1001 }, () => rect(plotIds[0])))).toMatchObject({
      ok: false,
    });
    expect(await save("nope")).toMatchObject({ ok: false });
    // the earlier map is untouched by every refused save
    expect((await db.layoutShape.findMany({ where: { projectId } })).map((s) => s.plotId)).toEqual([
      plotIds[0],
    ]);
  });

  it("refuses a plot from another project, and a project from another company", async () => {
    const other = await db.builder.create({ data: { companyName: "Other", status: "VERIFIED" } });
    const otherProject = await db.project.create({
      data: { builderId: other.id, name: "X", slug: "x", type: "PLOTTED" },
    });
    const foreign = await db.plot.create({
      data: { projectId: otherProject.id, number: "Z-1", sortKey: "z-00000001", sizeSqft: 900 },
    });
    expect(await save([rect(foreign.id)])).toMatchObject({ ok: false });
    expect(await save([rect(plotIds[0])], { builderId: other.id })).toMatchObject({ ok: false });
    expect(await db.layoutShape.count()).toBe(0);
  });

  it("removes a rectangle together with its plot", async () => {
    await save([rect(plotIds[0]), rect(plotIds[1], 30)]);
    await db.plot.delete({ where: { id: plotIds[0] } });
    expect(await db.layoutShape.count({ where: { projectId } })).toBe(1);
  });

  it("loads the map as buyers see it: a plot on hold shows as booked", async () => {
    expect(await loadLayoutMap(db, projectId)).toBeNull();
    await save(plotIds.map((id, i) => rect(id, i * 20)));
    const map = await loadLayoutMap(db, projectId);
    expect(map?.imageUrl).toBeNull();
    expect(map?.shapes.map((s) => [s.plot.number, s.plot.status])).toEqual([
      ["A-1", "AVAILABLE"],
      ["A-2", "BOOKED"],
      ["A-3", "SOLD"],
    ]);
  });

  it("uses a layout image, but not a PDF, as the background", async () => {
    await save([rect(plotIds[0])]);
    await db.projectMedia.create({
      data: {
        projectId,
        kind: "LAYOUT",
        storageKey: "p/layout.pdf",
        originalName: "l.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        uploadedById: "u",
      },
    });
    expect((await loadLayoutMap(db, projectId))?.imageUrl).toBeNull();
    await db.projectMedia.create({
      data: {
        projectId,
        kind: "LAYOUT",
        storageKey: "p/layout.png",
        originalName: "l.png",
        mimeType: "image/png",
        sizeBytes: 1,
        uploadedById: "u",
      },
    });
    expect((await loadLayoutMap(db, projectId))?.imageUrl).toContain("layout.png");
  });
});
