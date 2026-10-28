import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { entitlementsForPlan } from "@/lib/entitlements";
import {
  addPlots,
  deletePlots,
  plotCountsByStatus,
  setPlotStatuses,
  updatePlot,
} from "@/lib/plots/service";
import { parsePlotRow, type PlotInput } from "@/lib/plots/row";
import { createProject, loadChecklist, transitionProject } from "@/lib/projects/service";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md):
//   TEST_DATABASE_URL=postgresql://... npm test
const url = process.env.TEST_DATABASE_URL;

function plot(number: string, size = 1200, extra: Record<string, unknown> = {}): PlotInput {
  const parsed = parsePlotRow({ number, sizeSqft: size, ratePerSqft: 1850, ...extra });
  if (!parsed.ok) throw new Error(parsed.errors.join(", "));
  return parsed.value;
}

describe.skipIf(!url)("projects and plots (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let userId: string;

  beforeEach(async () => {
    await db.plotStatusLog.deleteMany();
    await db.auditLog.deleteMany();
    await db.project.deleteMany(); // cascades to plots, approvals, media
    await db.builder.deleteMany();
    await db.user.deleteMany();
    const user = await db.user.create({
      data: { auth0Sub: "auth0|t", email: "t@example.com", role: "BUILDER_OWNER" },
    });
    userId = user.id;
    const builder = await db.builder.create({
      data: {
        status: "VERIFIED",
        companyName: "Test Builders",
        members: { create: { userId, role: "OWNER" } },
      },
    });
    builderId = builder.id;
    await db.subscription.create({
      data: {
        builderId,
        plan: "GROWTH",
        interval: "MONTHLY",
        source: "COMP",
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function newProject(name = "Green Valley") {
    const result = await createProject(db, {
      builderId,
      actorId: userId,
      name,
      type: "PLOTTED",
      entitlements: entitlementsForPlan("GROWTH"),
    });
    if (!result.ok) throw new Error(result.message);
    return result.project;
  }

  /** Fills a project in so that it passes the checklist, optionally with a verified approval. */
  async function complete(projectId: string, options: { verifyApproval?: boolean } = {}) {
    await db.project.update({
      where: { id: projectId },
      data: {
        city: "Coimbatore",
        locality: "Sulur",
        addressLine: "Survey 12, Sulur Road",
        description: "A DTCP approved plotted layout close to the bypass with all utilities ready.",
        totalPlots: 50,
        landUse: "Residential",
        titleStatus: "Clear and marketable",
        pricePerSqft: 1850,
        contactName: "Anand",
        contactMobile: "9876543210",
      },
    });
    await addPlots(db, {
      projectId,
      actorId: userId,
      plots: [plot("A-1"), plot("A-2")],
      via: "manual",
    });
    await db.projectApproval.create({
      data: {
        projectId,
        kind: "RERA",
        number: "TN/29/0123/2026",
        verified: options.verifyApproval ?? false,
      },
    });
    await db.projectMedia.createMany({
      data: [1, 2, 3].map((n) => ({
        projectId,
        kind: "PHOTO" as const,
        storageKey: `x/${n}.jpg`,
        originalName: `${n}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 100,
        uploadedById: userId,
      })),
    });
  }

  describe("createProject", () => {
    it("creates a draft and audits it", async () => {
      const project = await newProject();
      expect(project).toMatchObject({
        status: "DRAFT",
        name: "Green Valley",
        type: "PLOTTED",
        builderId,
      });
      expect(
        await db.auditLog.count({ where: { action: "project.created", entityId: project.id } }),
      ).toBe(1);
    });

    it("refuses a bad name or type", async () => {
      const base = { builderId, actorId: userId, entitlements: entitlementsForPlan("GROWTH") };
      expect((await createProject(db, { ...base, name: "ab", type: "PLOTTED" })).ok).toBe(false);
      expect((await createProject(db, { ...base, name: "Fine Name", type: "CASTLE" })).ok).toBe(
        false,
      );
    });

    it("enforces the plan's project limit, and archived projects do not count", async () => {
      const starter = {
        builderId,
        actorId: userId,
        type: "PLOTTED",
        entitlements: entitlementsForPlan("STARTER"),
      };
      const first = await createProject(db, { ...starter, name: "First Project" });
      await createProject(db, { ...starter, name: "Second Project" });
      const third = await createProject(db, { ...starter, name: "Third Project" });
      expect(third).toMatchObject({ ok: false, code: "limit" });

      if (first.ok)
        await db.project.update({ where: { id: first.project.id }, data: { status: "ARCHIVED" } });
      expect((await createProject(db, { ...starter, name: "Third Project" })).ok).toBe(true);
    });

    it("has no limit on unlimited plans", async () => {
      const premier = {
        builderId,
        actorId: userId,
        type: "PLOTTED",
        entitlements: entitlementsForPlan("PREMIER"),
      };
      for (let i = 0; i < 8; i++)
        expect((await createProject(db, { ...premier, name: `Project ${i}` })).ok).toBe(true);
    });
  });

  describe("loadChecklist", () => {
    it("counts plots, approvals and photos from the database", async () => {
      const project = await newProject();
      const before = await loadChecklist(db, project.id);
      expect(before?.canSubmit).toBe(true); // nothing is mandatory
      expect(before?.items.find((i) => i.key === "plots")?.done).toBe(false);
      await complete(project.id);
      const list = await loadChecklist(db, project.id);
      expect(list?.missingRequired).toEqual([]);
      expect(list?.canSubmit).toBe(true);
      for (const key of ["plots", "approval", "photos", "price"])
        expect(list?.items.find((i) => i.key === key)?.done).toBe(true);
      expect(list!.percent).toBeGreaterThan(before!.percent);
    });

    it("returns null for a project that does not exist", async () => {
      expect(await loadChecklist(db, "nope")).toBeNull();
    });
  });

  describe("transitionProject", () => {
    const builderActor = () => ({ id: userId, kind: "builder" as const });
    const admin = { id: "admin-1", kind: "admin" as const };

    it("submits and approves a project that is far from complete", async () => {
      const project = await newProject();
      const submitted = await transitionProject(db, {
        projectId: project.id,
        action: "SUBMIT",
        actor: builderActor(),
        builderId,
      });
      expect(submitted).toMatchObject({ ok: true, to: "SUBMITTED" });
      // No plots, no photos, no verified approval: the admin may still approve it.
      const live = await transitionProject(db, {
        projectId: project.id,
        action: "APPROVE",
        actor: admin,
      });
      expect(live).toMatchObject({ ok: true, to: "LIVE" });
      if (live.ok) expect(live.project.slug).toBeTruthy();
    });

    it("will not submit a project whose details contradict each other", async () => {
      const project = await newProject();
      await db.project.update({
        where: { id: project.id },
        data: { budgetFrom: 9_000_000, budgetTo: 1_000_000 },
      });
      expect(
        await transitionProject(db, {
          projectId: project.id,
          action: "SUBMIT",
          actor: builderActor(),
          builderId,
        }),
      ).toMatchObject({ ok: false, code: "incomplete" });
    });

    describe("the plan is never needed to go live", () => {
      const submit = (projectId: string) =>
        transitionProject(db, { projectId, action: "SUBMIT", actor: builderActor(), builderId });

      it("lets a company with no plan submit, and staff approve and resume", async () => {
        const project = await newProject();
        await db.subscription.delete({ where: { builderId } });
        expect((await submit(project.id)).ok).toBe(true);
        expect(
          (await transitionProject(db, { projectId: project.id, action: "APPROVE", actor: admin }))
            .ok,
        ).toBe(true);
        const live = await db.project.findUniqueOrThrow({ where: { id: project.id } });
        expect(live).toMatchObject({ status: "LIVE" });
        expect(live.slug).toBeTruthy();
        await transitionProject(db, {
          projectId: project.id,
          action: "PAUSE",
          actor: admin,
          note: "Complaint under review.",
        });
        expect(
          (await transitionProject(db, { projectId: project.id, action: "RESUME", actor: admin }))
            .ok,
        ).toBe(true);
      });

      it("treats an ended plan the same way: nothing about publishing changes", async () => {
        const project = await newProject();
        await db.subscription.update({ where: { builderId }, data: { status: "EXPIRED" } });
        expect((await submit(project.id)).ok).toBe(true);
        expect(
          (await transitionProject(db, { projectId: project.id, action: "APPROVE", actor: admin }))
            .ok,
        ).toBe(true);
      });

      it("records why an admin paused a project, and forgets it on resume", async () => {
        const project = await newProject();
        await submit(project.id);
        await transitionProject(db, { projectId: project.id, action: "APPROVE", actor: admin });
        await transitionProject(db, {
          projectId: project.id,
          action: "PAUSE",
          actor: admin,
          note: "Complaint under review.",
        });
        expect(
          (await db.project.findUniqueOrThrow({ where: { id: project.id } })).pauseReason,
        ).toBe("ADMIN");
        await transitionProject(db, { projectId: project.id, action: "RESUME", actor: admin });
        expect(
          (await db.project.findUniqueOrThrow({ where: { id: project.id } })).pauseReason,
        ).toBeNull();
      });
    });

    it("will not submit for a builder who is not verified yet", async () => {
      const project = await newProject();
      await complete(project.id);
      await db.builder.update({ where: { id: builderId }, data: { status: "SUBMITTED" } });
      expect(
        await transitionProject(db, {
          projectId: project.id,
          action: "SUBMIT",
          actor: builderActor(),
          builderId,
        }),
      ).toMatchObject({
        ok: false,
        code: "builder_not_verified",
      });
    });

    it("cannot be driven by the wrong kind of user or the wrong builder", async () => {
      const project = await newProject();
      await complete(project.id);
      expect(
        await transitionProject(db, {
          projectId: project.id,
          action: "APPROVE",
          actor: builderActor(),
          builderId,
        }),
      ).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(
        await transitionProject(db, { projectId: project.id, action: "SUBMIT", actor: admin }),
      ).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(
        await transitionProject(db, {
          projectId: project.id,
          action: "SUBMIT",
          actor: builderActor(),
          builderId: "another-builder",
        }),
      ).toMatchObject({
        ok: false,
        code: "not_found",
      });
    });

    it("runs the whole life: submit, request changes, resubmit, approve, reopen, resubmit, pause, resume, archive", async () => {
      const project = await newProject();
      await complete(project.id);
      const run = async (
        action: Parameters<typeof transitionProject>[1]["action"],
        actor: typeof admin | ReturnType<typeof builderActor>,
        note?: string,
      ) => {
        const result = await transitionProject(db, {
          projectId: project.id,
          action,
          actor,
          ...(actor.kind === "builder" ? { builderId } : {}),
          note,
        });
        if (!result.ok) throw new Error(`${action}: ${result.message}`);
        return result.project;
      };

      expect((await run("SUBMIT", builderActor())).status).toBe("SUBMITTED");
      const changes = await run("REQUEST_CHANGES", admin, "Please add the layout plan.");
      expect(changes).toMatchObject({
        status: "CHANGES_REQUESTED",
        reviewNote: "Please add the layout plan.",
      });
      expect((await run("SUBMIT", builderActor())).reviewNote).toBeNull();

      const live = await run("APPROVE", admin);
      expect(live.status).toBe("LIVE");
      expect(live.slug).toBe("green-valley-coimbatore");
      expect(live.publishedAt).not.toBeNull();

      expect((await run("REOPEN", builderActor())).status).toBe("CHANGES_REQUESTED");
      await run("SUBMIT", builderActor());
      const again = await run("APPROVE", admin);
      expect(again.slug).toBe("green-valley-coimbatore"); // the address never changes
      expect(again.publishedAt?.getTime()).toBe(live.publishedAt?.getTime());

      expect((await run("PAUSE", admin, "Approval is being renewed.")).status).toBe("PAUSED");
      expect((await run("RESUME", admin)).status).toBe("LIVE");
      expect((await run("ARCHIVE", builderActor())).status).toBe("ARCHIVED");

      const actions = (
        await db.auditLog.findMany({
          where: { entityId: project.id },
          orderBy: { createdAt: "asc" },
        })
      ).map((a) => a.action);
      expect(actions).toEqual([
        "project.created",
        "project.submit",
        "project.request_changes",
        "project.submit",
        "project.approve",
        "project.reopen",
        "project.submit",
        "project.approve",
        "project.pause",
        "project.resume",
        "project.archive",
      ]);
    });

    it("requires a real note to request changes or pause", async () => {
      const project = await newProject();
      await complete(project.id, { verifyApproval: true });
      await transitionProject(db, {
        projectId: project.id,
        action: "SUBMIT",
        actor: builderActor(),
        builderId,
      });
      expect(
        await transitionProject(db, {
          projectId: project.id,
          action: "REQUEST_CHANGES",
          actor: admin,
          note: "no",
        }),
      ).toMatchObject({
        ok: false,
        code: "note",
      });
    });

    it("lets only one of two simultaneous approvals win", async () => {
      const project = await newProject();
      await complete(project.id, { verifyApproval: true });
      await transitionProject(db, {
        projectId: project.id,
        action: "SUBMIT",
        actor: builderActor(),
        builderId,
      });

      const results = await Promise.all([
        transitionProject(db, {
          projectId: project.id,
          action: "APPROVE",
          actor: { id: "a1", kind: "admin" },
        }),
        transitionProject(db, {
          projectId: project.id,
          action: "APPROVE",
          actor: { id: "a2", kind: "admin" },
        }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(
        await db.auditLog.count({ where: { action: "project.approve", entityId: project.id } }),
      ).toBe(1);
    });

    it("gives two projects with the same name different addresses", async () => {
      const slugs: string[] = [];
      for (const name of ["Twin Towers", "Twin Towers"]) {
        const project = await newProject(name);
        await complete(project.id, { verifyApproval: true });
        await transitionProject(db, {
          projectId: project.id,
          action: "SUBMIT",
          actor: builderActor(),
          builderId,
        });
        const done = await transitionProject(db, {
          projectId: project.id,
          action: "APPROVE",
          actor: admin,
        });
        if (done.ok && done.project.slug) slugs.push(done.project.slug);
      }
      expect(slugs).toEqual(["twin-towers-coimbatore", "twin-towers-coimbatore-2"]);
    });
  });

  describe("plots", () => {
    it("adds plots and logs their first status", async () => {
      const project = await newProject();
      const result = await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: [plot("A-1"), plot("A-2", 1500, { status: "Booked" })],
        via: "manual",
      });
      expect(result).toEqual({ ok: true, created: 2 });
      const logs = await db.plotStatusLog.findMany({
        where: { projectId: project.id },
        orderBy: { plotNumber: "asc" },
      });
      expect(logs.map((l) => [l.plotNumber, l.fromStatus, l.toStatus, l.via])).toEqual([
        ["A-1", null, "AVAILABLE", "manual"],
        ["A-2", null, "BOOKED", "manual"],
      ]);
    });

    it("stores a natural sort key", async () => {
      const project = await newProject();
      await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: ["A-10", "A-2", "A-1"].map((n) => plot(n)),
        via: "manual",
      });
      const ordered = await db.plot.findMany({
        where: { projectId: project.id },
        orderBy: { sortKey: "asc" },
      });
      expect(ordered.map((p) => p.number)).toEqual(["A-1", "A-2", "A-10"]);
    });

    it("saves nothing at all when one plot in the batch clashes", async () => {
      const project = await newProject();
      await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: [plot("A-1")],
        via: "manual",
      });
      const result = await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: [plot("B-1"), plot("a-1"), plot("B-2")],
        via: "import",
      });
      expect(result).toMatchObject({ ok: false });
      expect(await db.plot.count({ where: { projectId: project.id } })).toBe(1);
      expect(await db.plotStatusLog.count({ where: { projectId: project.id } })).toBe(1);
    });

    it("lets only one of two simultaneous imports of the same plots win", async () => {
      const project = await newProject();
      const batch = [plot("S-1"), plot("S-2"), plot("S-3")];
      const results = await Promise.all([
        addPlots(db, { projectId: project.id, actorId: userId, plots: batch, via: "import" }),
        addPlots(db, { projectId: project.id, actorId: userId, plots: batch, via: "import" }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.plot.count({ where: { projectId: project.id } })).toBe(3);
    });

    it("keeps plot numbers separate between projects", async () => {
      const a = await newProject("Project A");
      const b = await newProject("Project B");
      expect(
        (
          await addPlots(db, {
            projectId: a.id,
            actorId: userId,
            plots: [plot("1")],
            via: "manual",
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await addPlots(db, {
            projectId: b.id,
            actorId: userId,
            plots: [plot("1")],
            via: "manual",
          })
        ).ok,
      ).toBe(true);
    });

    it("updates a plot, logs a status change, and rejects a number that clashes", async () => {
      const project = await newProject();
      await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: [plot("A-1"), plot("A-2")],
        via: "manual",
      });
      const [first, second] = await db.plot.findMany({
        where: { projectId: project.id },
        orderBy: { sortKey: "asc" },
      });

      expect(
        await updatePlot(db, {
          projectId: project.id,
          plotId: first.id,
          plot: plot("A-1", 1800, { status: "Sold" }),
          actorId: userId,
        }),
      ).toEqual({ ok: true });
      const updated = await db.plot.findUniqueOrThrow({ where: { id: first.id } });
      expect(updated).toMatchObject({ sizeSqft: 1800, status: "SOLD", price: 1800 * 1850 });
      expect(
        await db.plotStatusLog.count({
          where: { plotId: first.id, toStatus: "SOLD", fromStatus: "AVAILABLE" },
        }),
      ).toBe(1);

      expect(
        await updatePlot(db, {
          projectId: project.id,
          plotId: second.id,
          plot: plot("a-1"),
          actorId: userId,
        }),
      ).toMatchObject({ ok: false });
      // renaming a plot to its own number in a different case is fine
      expect(
        await updatePlot(db, {
          projectId: project.id,
          plotId: second.id,
          plot: plot("a-2"),
          actorId: userId,
        }),
      ).toEqual({ ok: true });
    });

    it("cannot edit a plot through another project", async () => {
      const a = await newProject("Project A");
      const b = await newProject("Project B");
      await addPlots(db, { projectId: a.id, actorId: userId, plots: [plot("1")], via: "manual" });
      const target = await db.plot.findFirstOrThrow({ where: { projectId: a.id } });
      expect(
        await updatePlot(db, {
          projectId: b.id,
          plotId: target.id,
          plot: plot("1", 9999),
          actorId: userId,
        }),
      ).toMatchObject({ ok: false });
      expect((await db.plot.findUniqueOrThrow({ where: { id: target.id } })).sizeSqft).toBe(1200);
    });

    it("changes many statuses at once, logging each, and never touches held plots", async () => {
      const project = await newProject();
      await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: ["1", "2", "3", "4"].map((n) => plot(n)),
        via: "manual",
      });
      const plots = await db.plot.findMany({
        where: { projectId: project.id },
        orderBy: { sortKey: "asc" },
      });
      await db.plot.update({ where: { id: plots[3].id }, data: { status: "HELD" } });
      await db.plot.update({ where: { id: plots[2].id }, data: { status: "SOLD" } });

      const result = await setPlotStatuses(db, {
        projectId: project.id,
        plotIds: plots.map((p) => p.id),
        status: "SOLD",
        actorId: userId,
        via: "bulk",
      });
      expect(result).toEqual({ changed: 2, skipped: 2 }); // 1 and 2 changed; 3 already sold; 4 is held
      expect((await db.plot.findUniqueOrThrow({ where: { id: plots[3].id } })).status).toBe("HELD");
      expect(await db.plotStatusLog.count({ where: { projectId: project.id, via: "bulk" } })).toBe(
        2,
      );
      expect(await plotCountsByStatus(db, project.id)).toEqual({
        AVAILABLE: 0,
        HELD: 1,
        BOOKED: 0,
        SOLD: 3,
        total: 4,
      });
    });

    it("ignores ids that belong to another project", async () => {
      const a = await newProject("Project A");
      const b = await newProject("Project B");
      await addPlots(db, { projectId: a.id, actorId: userId, plots: [plot("1")], via: "manual" });
      const foreign = await db.plot.findFirstOrThrow({ where: { projectId: a.id } });
      expect(
        await setPlotStatuses(db, {
          projectId: b.id,
          plotIds: [foreign.id],
          status: "SOLD",
          actorId: userId,
          via: "bulk",
        }),
      ).toEqual({ changed: 0, skipped: 0 });
      expect(
        await deletePlots(db, { projectId: b.id, plotIds: [foreign.id], actorId: userId }),
      ).toEqual({ deleted: 0 });
      expect((await db.plot.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
        "AVAILABLE",
      );
    });

    it("deletes plots, keeps their history, and audits the deletion", async () => {
      const project = await newProject();
      await addPlots(db, {
        projectId: project.id,
        actorId: userId,
        plots: [plot("A-1"), plot("A-2")],
        via: "manual",
      });
      const plots = await db.plot.findMany({ where: { projectId: project.id } });
      expect(
        await deletePlots(db, { projectId: project.id, plotIds: [plots[0].id], actorId: userId }),
      ).toEqual({ deleted: 1 });
      expect(await db.plot.count({ where: { projectId: project.id } })).toBe(1);
      expect(await db.plotStatusLog.count({ where: { plotId: plots[0].id } })).toBe(1); // history survives
      expect(
        await db.auditLog.count({ where: { action: "plots.deleted", entityId: project.id } }),
      ).toBe(1);
    });
  });

  it("deleting a project removes its plots, approvals and media", async () => {
    const project = await newProject();
    await complete(project.id);
    await db.project.delete({ where: { id: project.id } });
    expect(await db.plot.count()).toBe(0);
    expect(await db.projectApproval.count()).toBe(0);
    expect(await db.projectMedia.count()).toBe(0);
  });
});
