import "server-only";
import { revalidatePath } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Public pages are cached so they load fast. Call this whenever a change should show up for
 * buyers straight away (a plot sold, an approval verified, a project paused), and the cached
 * copies of that project's pages, its builder's page and the home page are thrown away.
 *
 * The pages also refresh themselves every couple of minutes, so a missed call can only ever
 * leave a page slightly out of date, never wrong for long.
 */
export async function revalidateProjectPages(db: PrismaClient, projectId: string): Promise<void> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { slug: true, builder: { select: { slug: true } } },
    });
    if (project?.slug) revalidatePath(`/project/${project.slug}`);
    if (project?.builder.slug) revalidatePath(`/builder/${project.builder.slug}`);
    revalidatePath("/");
  } catch (error) {
    // Never fail the builder's action because a cache could not be cleared.
    console.error("Could not refresh public pages", error);
  }
}

/** For a change to the company itself (name, logo, about) rather than one project. */
export async function revalidateBuilderPages(db: PrismaClient, builderId: string): Promise<void> {
  try {
    const builder = await db.builder.findUnique({
      where: { id: builderId },
      select: { slug: true, projects: { where: { slug: { not: null } }, select: { slug: true } } },
    });
    if (builder?.slug) revalidatePath(`/builder/${builder.slug}`);
    for (const project of builder?.projects ?? [])
      if (project.slug) revalidatePath(`/project/${project.slug}`);
    revalidatePath("/");
  } catch (error) {
    console.error("Could not refresh public pages", error);
  }
}
