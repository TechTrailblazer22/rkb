import type { PrismaClient, Project } from "@/generated/prisma/client";
import type { ProjectType } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { uniqueSlug } from "@/lib/builders/slug";
import type { Entitlements } from "@/lib/entitlements";
import { buildProjectChecklist, type ProjectChecklist } from "@/lib/projects/checklist";
import { PROJECT_FIELDS } from "@/lib/projects/fields";
import {
  mayPerform,
  nextProjectStatus,
  type Actor,
  type ProjectAction,
} from "@/lib/projects/status";

export type ServiceError = { ok: false; code: string; message: string };
const fail = (code: string, message: string): ServiceError => ({ ok: false, code, message });

export const NOTE_MIN = 10;

// ---------------------------------------------------------------------------------------

export async function createProject(
  db: PrismaClient,
  input: {
    builderId: string;
    actorId: string;
    name: string;
    type: string;
    entitlements: Entitlements;
  },
): Promise<{ ok: true; project: Project } | ServiceError> {
  const name = PROJECT_FIELDS.name.parse(input.name.trim());
  if (!name.ok) return fail("invalid", name.error);
  const type = PROJECT_FIELDS.type.parse(input.type);
  if (!type.ok) return fail("invalid", "Choose a project type.");

  const limit = input.entitlements.maxProjects;
  if (limit !== null) {
    const used = await db.project.count({
      where: { builderId: input.builderId, status: { not: "ARCHIVED" } },
    });
    if (used >= limit) {
      return fail(
        "limit",
        `Your plan allows ${limit} projects and you have ${used}. Archive one you no longer need, or upgrade.`,
      );
    }
  }

  const project = await db.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        builderId: input.builderId,
        name: name.value as string,
        type: type.value as ProjectType,
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "project.created",
      entity: "Project",
      entityId: created.id,
      meta: { builderId: input.builderId },
    });
    return created;
  });
  return { ok: true, project };
}

// ---------------------------------------------------------------------------------------

/** Everything the checklist needs, read from the database. */
export async function loadChecklist(
  db: PrismaClient,
  projectId: string,
): Promise<ProjectChecklist | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { approvals: { select: { kind: true, number: true, validTill: true } } },
  });
  if (!project) return null;

  const [plotCount, pricedPlotCount, media] = await Promise.all([
    db.plot.count({ where: { projectId } }),
    db.plot.count({ where: { projectId, price: { not: null } } }),
    db.projectMedia.groupBy({ by: ["kind"], where: { projectId }, _count: { _all: true } }),
  ]);
  const count = (kind: string) => media.find((m) => m.kind === kind)?._count._all ?? 0;

  return buildProjectChecklist({
    project,
    plotCount,
    pricedPlotCount,
    approvals: project.approvals,
    photoCount: count("PHOTO"),
    hasLayout: count("LAYOUT") > 0,
    hasBrochure: count("BROCHURE") > 0,
  });
}

// ---------------------------------------------------------------------------------------

export type TransitionResult =
  { ok: true; project: Project; from: Project["status"]; to: Project["status"] } | ServiceError;

/**
 * The one door through which a project's status changes. It checks who is asking, whether the
 * change is legal from the current status, and the preconditions, then applies it with a
 * compare-and-set so two simultaneous requests cannot both win. Every change is audited.
 */
export async function transitionProject(
  db: PrismaClient,
  input: {
    projectId: string;
    action: ProjectAction;
    actor: { id: string; kind: Actor };
    /** When set, the project must belong to this builder (used for builder-side calls). */
    builderId?: string;
    note?: string;
  },
): Promise<TransitionResult> {
  const { action, actor } = input;
  if (!mayPerform(action, actor.kind)) return fail("forbidden", "You cannot do that.");

  const project = await db.project.findFirst({
    where: { id: input.projectId, ...(input.builderId ? { builderId: input.builderId } : {}) },
    include: { builder: { select: { status: true } }, approvals: true },
  });
  if (!project) return fail("not_found", "Project not found.");

  const target = nextProjectStatus(project.status, action);
  if (!target)
    return fail("illegal", "That action is not available for this project's current status.");

  const note = input.note?.trim() ?? "";
  if (["REQUEST_CHANGES", "PAUSE"].includes(action) && note.length < NOTE_MIN) {
    return fail("note", `Add a note of at least ${NOTE_MIN} characters so the builder knows why.`);
  }

  if (action === "SUBMIT" || action === "APPROVE") {
    // Listings only ever go live for verified builders.
    if (project.builder.status !== "VERIFIED") {
      return fail(
        "builder_not_verified",
        action === "SUBMIT"
          ? "Your company must be verified before you can submit a project. Finish your company application first."
          : "The builder is not verified, so this project cannot go live.",
      );
    }
    const checklist = await loadChecklist(db, project.id);
    if (!checklist?.canSubmit) {
      return fail(
        "incomplete",
        "Some details in the project contradict each other. Fix the items listed first.",
      );
    }
  }
  // No approval has to be verified for a project to go live. The public page labels each
  // approval as verified or not, so buyers always see which ones RKB has checked.

  const now = new Date();
  const slug =
    action === "APPROVE" && !project.slug
      ? await uniqueSlug(
          `${project.name} ${project.city ?? ""}`,
          async (candidate) => (await db.project.count({ where: { slug: candidate } })) > 0,
        )
      : undefined;

  const updated = await db.$transaction(async (tx) => {
    const data: Record<string, unknown> = { status: target };
    if (action === "SUBMIT") Object.assign(data, { submittedAt: now, reviewNote: null });
    if (action === "APPROVE") {
      Object.assign(data, {
        reviewedAt: now,
        reviewedById: actor.id,
        reviewNote: null,
        publishedAt: project.publishedAt ?? now,
        ...(slug ? { slug } : {}),
      });
    }
    if (action === "REQUEST_CHANGES" || action === "PAUSE") {
      Object.assign(data, { reviewedAt: now, reviewedById: actor.id, reviewNote: note });
    }
    if (action === "RESUME")
      Object.assign(data, { reviewedAt: now, reviewedById: actor.id, reviewNote: null });
    if (action === "REOPEN") Object.assign(data, { reviewNote: null });

    const changed = await tx.project.updateMany({
      where: { id: project.id, status: project.status },
      data,
    });
    if (changed.count !== 1) return null; // someone else changed it first
    await recordAudit(tx, {
      actorId: actor.id,
      action: `project.${action.toLowerCase()}`,
      entity: "Project",
      entityId: project.id,
      meta: { from: project.status, to: target, ...(note ? { note } : {}) },
    });
    return tx.project.findUniqueOrThrow({ where: { id: project.id } });
  });

  if (!updated)
    return fail("conflict", "This project was changed by someone else. Reload and try again.");
  return { ok: true, project: updated, from: project.status, to: target };
}
