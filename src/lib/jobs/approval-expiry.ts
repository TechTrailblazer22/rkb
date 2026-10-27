import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { builderRecipients } from "@/lib/leads/service";
import { sendMail, type MailMessage } from "@/lib/mail";
import { approvalExpiringMail, projectPausedMail } from "@/lib/mail/templates";

type Send = (message: MailMessage) => Promise<void>;

const DAY = 86_400_000;
/** Warn at these many days left. A warning is sent once per step, never repeated. */
const WARN_AT = [30, 7, 1];
const KINDS = ["RERA", "TNCP", "MUNICIPAL"] as const;

const startOfDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * For the live projects: warns the builder 30, 7 and 1 days before an approval expires, and takes
 * the project offline (paused) once one has expired, because buyers must not be shown an approval
 * that no longer holds. "Expired" matches the project checklist: valid through the end of the last
 * day.
 *
 * Safe to run twice: a warning step is claimed before it is sent, and a project is paused only if
 * it is still live.
 */
export async function processApprovalExpiry(
  db: PrismaClient,
  now: Date = new Date(),
  send: Send = sendMail,
): Promise<{ warned: number; paused: number; pausedProjectIds: string[] }> {
  const today = startOfDay(now);
  const approvals = await db.projectApproval.findMany({
    where: {
      number: { not: null },
      kind: { in: [...KINDS] },
      validTill: { not: null, lt: new Date(today + (WARN_AT[0] + 1) * DAY) },
      project: { status: "LIVE" },
    },
    select: {
      id: true,
      kind: true,
      validTill: true,
      warnedDays: true,
      project: { select: { id: true, name: true, builderId: true } },
    },
    orderBy: { validTill: "asc" },
    take: 1000,
  });

  let warned = 0;
  const pausedProjectIds: string[] = [];

  for (const approval of approvals) {
    const validTill = approval.validTill!;
    const { project } = approval;

    if (validTill.getTime() < today) {
      const when = validTill.toISOString().slice(0, 10);
      const note = `The ${approval.kind} approval expired on ${when}. The project is offline until the approval is renewed and checked again.`;
      const paused = await db.$transaction(async (tx) => {
        const won = await tx.project.updateMany({
          where: { id: project.id, status: "LIVE" },
          data: {
            status: "PAUSED",
            pauseReason: "APPROVAL_EXPIRED",
            reviewNote: note,
            reviewedAt: now,
          },
        });
        if (won.count !== 1) return false;
        await recordAudit(tx, {
          actorId: null,
          action: "project.paused_expired_approval",
          entity: "Project",
          entityId: project.id,
          meta: { approvalId: approval.id, kind: approval.kind, validTill: when },
        });
        return true;
      });
      if (!paused) continue;
      pausedProjectIds.push(project.id);
      const to = await builderRecipients(db, project.builderId);
      if (to.length > 0) {
        await send({
          to,
          ...projectPausedMail({ projectName: project.name, projectId: project.id, note }),
        });
      }
      continue;
    }

    const daysLeft = Math.round((startOfDay(validTill) - today) / DAY);
    const step = WARN_AT.slice()
      .reverse()
      .find((days) => daysLeft <= days);
    if (step === undefined) continue;
    if (approval.warnedDays !== null && approval.warnedDays <= step) continue;

    const won = await db.projectApproval.updateMany({
      where: { id: approval.id, OR: [{ warnedDays: null }, { warnedDays: { gt: step } }] },
      data: { warnedDays: step },
    });
    if (won.count !== 1) continue;
    const to = await builderRecipients(db, project.builderId);
    if (to.length === 0) continue;
    await send({
      to,
      ...approvalExpiringMail({
        projectName: project.name,
        projectId: project.id,
        kind: approval.kind,
        daysLeft,
      }),
    });
    warned++;
  }

  return { warned, paused: pausedProjectIds.length, pausedProjectIds };
}
