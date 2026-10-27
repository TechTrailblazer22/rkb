import type { PrismaClient } from "@/generated/prisma/client";
import { recordStat } from "@/lib/analytics/stats";

export type ShortlistResult = { ok: true; saved: boolean } | { ok: false; code: "not_found" };

/** The ids of everything this user has saved, newest first. */
export async function listShortlistIds(db: PrismaClient, userId: string): Promise<string[]> {
  const rows = await db.shortlist.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { projectId: true },
    take: 500,
  });
  return rows.map((row) => row.projectId);
}

/**
 * Saves or un-saves a project. Only a project that is public right now can be saved, so the
 * list can never reveal a draft or an unverified builder's project. Saving twice is harmless.
 * Un-saving always works, even for a project that has since gone offline.
 */
export async function setShortlisted(
  db: PrismaClient,
  input: { userId: string; projectId: string; saved: boolean },
): Promise<ShortlistResult> {
  const { userId, projectId, saved } = input;

  if (!saved) {
    await db.shortlist.deleteMany({ where: { userId, projectId } });
    return { ok: true, saved: false };
  }

  const project = await db.project.findFirst({
    where: { id: projectId, status: "LIVE", slug: { not: null }, builder: { status: "VERIFIED" } },
    select: { id: true },
  });
  if (!project) return { ok: false, code: "not_found" };

  const already = await db.shortlist.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { projectId: true },
  });
  await db.shortlist.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId },
    update: {},
  });
  // Counted once per person per project, however often the heart is pressed.
  if (!already) await recordStat(db, { projectId, event: "SHORTLIST" }).catch(() => {});
  return { ok: true, saved: true };
}
