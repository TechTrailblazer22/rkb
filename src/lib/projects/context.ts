import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Project } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { requireBuilderContext, type BuilderContext } from "@/lib/builders/context";
import { entitlementsForBuilder, type Entitlements } from "@/lib/entitlements";
import type { ProjectChecklist } from "@/lib/projects/checklist";
import { loadChecklist } from "@/lib/projects/service";
import { projectEditMode, type ProjectEditMode } from "@/lib/projects/status";
import type { AppUser } from "@/lib/auth/sync-user";

export type ProjectContext = BuilderContext & {
  project: Project;
  projectMode: ProjectEditMode;
  projectChecklist: ProjectChecklist;
  entitlements: Entitlements;
};

const loadProject = cache(async (projectId: string, builderId: string) =>
  getDb().project.findFirst({ where: { id: projectId, builderId } }),
);

/**
 * For every builder-side project page and action. The project is found through the signed-in
 * builder (never by id alone), so a project id in a URL or form cannot reach someone else's
 * project: it simply is not found. A suspended or rejected builder cannot edit anything.
 */
export async function requireProjectContext(
  projectId: string,
  returnTo: string,
): Promise<ProjectContext> {
  const ctx = await requireBuilderContext(returnTo);
  const project = await loadProject(projectId, ctx.builder.id);
  if (!project) notFound();

  const checklist = await loadChecklist(getDb(), project.id);
  if (!checklist) notFound();

  const builderBlocked = ctx.builder.status === "SUSPENDED" || ctx.builder.status === "REJECTED";
  return {
    ...ctx,
    project,
    projectMode: builderBlocked ? "locked" : projectEditMode(project.status),
    projectChecklist: checklist,
    entitlements: entitlementsForBuilder(ctx.builder),
  };
}

/**
 * The same ownership check for route handlers, which answer with a status code instead of
 * redirecting. Returns null when the project is not one of this user's builder's projects.
 */
export async function findOwnedProject(user: AppUser, projectId: string) {
  if (user.role !== "BUILDER_OWNER" && user.role !== "BUILDER_TEAM") return null;
  const project = await getDb().project.findFirst({
    where: { id: projectId, builderId: { in: user.builderIds } },
    include: { builder: { select: { id: true, status: true, interestedPlan: true } } },
  });
  if (!project) return null;
  const blocked = project.builder.status === "SUSPENDED" || project.builder.status === "REJECTED";
  return { project, mode: blocked ? ("locked" as const) : projectEditMode(project.status) };
}
