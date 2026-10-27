import type { PrismaClient, ProgressUpdate } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { sendMail, type MailMessage } from "@/lib/mail";
import { progressUpdateMail } from "@/lib/mail/templates";
import { cleanText } from "@/lib/reviews/service";
import { safePublicUrl } from "@/lib/storage/url";

// Construction progress: a dated note, with an optional photo, that appears on the project page.
// People who saved the project are emailed, within limits: at most one email per person per project
// per day, and at most NOTIFY_CAP people per update.

export const NOTE_MIN = 5;
export const NOTE_MAX = 500;
export const MAX_PER_DAY = 5;
export const NOTIFY_CAP = 200;
const DAY = 86_400_000;

// ProgressUpdate.notifiedCount: 0 = not handled yet, -1 = being handled, -2 = handled with nobody
// emailed, and 1 or more = that many people emailed.
const CLAIMED = -1;
const HANDLED = -2;

type Send = (message: MailMessage) => Promise<void>;

export type PostResult =
  | { ok: true; update: ProgressUpdate }
  | { ok: false; code: "invalid" | "not_found" | "too_many"; message: string };

/** Adds an update to a live project of the company. The photo, if any, is already stored. */
export async function postProgress(
  db: PrismaClient,
  input: {
    projectId: string;
    builderId: string;
    actorId: string;
    note: string;
    photoKey?: string | null;
    now?: Date;
  },
): Promise<PostResult> {
  const note = cleanText(input.note);
  if (note.length < NOTE_MIN || note.length > NOTE_MAX) {
    return {
      ok: false,
      code: "invalid",
      message: `Write ${NOTE_MIN} to ${NOTE_MAX} characters about how the work is going.`,
    };
  }
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({
    where: { id: input.projectId, builderId: input.builderId, status: "LIVE" },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, code: "not_found", message: "Updates can be posted for a live project." };
  }
  const today = await db.progressUpdate.count({
    where: { projectId: project.id, createdAt: { gte: new Date(now.getTime() - DAY) } },
  });
  if (today >= MAX_PER_DAY) {
    return {
      ok: false,
      code: "too_many",
      message: `That is ${MAX_PER_DAY} updates in a day. Please try again tomorrow.`,
    };
  }
  const update = await db.progressUpdate.create({
    data: {
      projectId: project.id,
      note,
      photoKey: input.photoKey ?? null,
      createdById: input.actorId,
      createdAt: now,
    },
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "progress.posted",
    entity: "Project",
    entityId: project.id,
    meta: { updateId: update.id },
  });
  return { ok: true, update };
}

export type PublicProgress = { id: string; note: string; photoUrl: string | null; createdAt: Date };

export async function listProgress(
  db: PrismaClient,
  projectId: string,
  take = 10,
): Promise<PublicProgress[]> {
  const rows = await db.progressUpdate.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    photoUrl: safePublicUrl(r.photoKey, 800),
    createdAt: r.createdAt,
  }));
}

/** Deletes an update of the company's own project, returning its photo key so it can be removed. */
export async function deleteProgress(
  db: PrismaClient,
  input: { updateId: string; builderId: string; actorId: string },
): Promise<{ ok: boolean; photoKey: string | null }> {
  const found = await db.progressUpdate.findFirst({
    where: { id: input.updateId, project: { builderId: input.builderId } },
    select: { id: true, photoKey: true, projectId: true },
  });
  if (!found) return { ok: false, photoKey: null };
  await db.progressUpdate.delete({ where: { id: found.id } });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "progress.deleted",
    entity: "Project",
    entityId: found.projectId,
  });
  return { ok: true, photoKey: found.photoKey };
}

/**
 * Emails people who saved the project about a new update. One email per person, addressed only to
 * them. A person who was already emailed about this project in the last day is skipped, and the
 * update is claimed first (`notifiedCount` goes from 0 to claimed), so running this twice, or two at
 * once, sends nothing the second time.
 */
export async function notifyShortlisters(
  db: PrismaClient,
  updateId: string,
  send: Send = sendMail,
  now: Date = new Date(),
): Promise<{ emailed: number }> {
  const claimed = await db.progressUpdate.updateMany({
    where: { id: updateId, notifiedCount: 0 },
    data: { notifiedCount: CLAIMED },
  });
  if (claimed.count !== 1) return { emailed: 0 };

  const update = await db.progressUpdate.findUniqueOrThrow({
    where: { id: updateId },
    select: {
      id: true,
      note: true,
      projectId: true,
      project: { select: { name: true, slug: true, builder: { select: { companyName: true } } } },
    },
  });

  // Anyone emailed about this project in the last day already has today's update in their inbox.
  const recent = await db.progressUpdate.findMany({
    where: {
      projectId: update.projectId,
      id: { not: update.id },
      notifiedCount: { gt: 0 },
      createdAt: { gte: new Date(now.getTime() - DAY) },
    },
    select: { id: true },
  });
  if (recent.length > 0 || !update.project.slug) {
    await db.progressUpdate.update({ where: { id: update.id }, data: { notifiedCount: HANDLED } });
    return { emailed: 0 };
  }

  const saved = await db.shortlist.findMany({
    where: { projectId: update.projectId },
    take: NOTIFY_CAP,
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true } } },
  });
  let emailed = 0;
  for (const row of saved) {
    try {
      await send({
        to: row.user.email,
        ...progressUpdateMail({
          projectName: update.project.name,
          companyName: update.project.builder.companyName,
          note: update.note,
          slug: update.project.slug,
        }),
      });
      emailed++;
    } catch (error) {
      // One bad address must not stop the rest.
      console.error("Could not send a progress update email", error);
    }
  }
  await db.progressUpdate.update({
    where: { id: update.id },
    data: { notifiedCount: emailed > 0 ? emailed : HANDLED },
  });
  return { emailed };
}
