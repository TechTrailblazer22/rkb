"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { sendMail } from "@/lib/mail";
import {
  projectApprovedMail,
  projectChangesRequestedMail,
  projectPausedMail,
} from "@/lib/mail/templates";
import { revalidateProjectPages } from "@/lib/projects/revalidate";
import { NOTE_MIN, transitionProject } from "@/lib/projects/service";

function back(projectId: string, params: Record<string, string> = {}): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/admin/projects/${projectId}${query ? `?${query}` : ""}`);
}

const verifySchema = z.object({
  projectId: z.string().min(1),
  approvalId: z.string().min(1),
  decision: z.enum(["verify", "unverify"]),
  note: z.string().trim().max(1000).optional(),
});

/** Mark an approval as checked against its certificate, or send it back with a reason. */
export async function verifyApproval(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin/projects", roles: ["ADMIN"] });
  const parsed = verifySchema.safeParse({
    projectId: formData.get("projectId"),
    approvalId: formData.get("approvalId"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) redirect("/admin/projects");
  const { projectId, approvalId, decision, note } = parsed.data;

  if (decision === "unverify" && (!note || note.length < NOTE_MIN)) {
    back(projectId, {
      error: `Add a note of at least ${NOTE_MIN} characters so the builder knows what is wrong.`,
    });
  }

  const db = getDb();
  const approval = await db.projectApproval.findFirst({ where: { id: approvalId, projectId } });
  if (!approval) back(projectId, { error: "That approval no longer exists." });
  if (decision === "verify" && (!approval.number || !approval.storageKey)) {
    back(projectId, {
      error: "Verify only after the builder has entered the number and attached the certificate.",
    });
  }

  await db.$transaction(async (tx) => {
    await tx.projectApproval.update({
      where: { id: approvalId },
      data:
        decision === "verify"
          ? { verified: true, verifiedAt: new Date(), reviewNote: null }
          : { verified: false, verifiedAt: null, reviewNote: note },
    });
    await recordAudit(tx, {
      actorId: admin.id,
      action: decision === "verify" ? "approval.verified" : "approval.rejected",
      entity: "Project",
      entityId: projectId,
      meta: { approvalId, kind: approval.kind, ...(note ? { note } : {}) },
    });
  });
  revalidatePath(`/admin/projects/${projectId}`);
  await revalidateProjectPages(db, projectId);
  back(projectId, { saved: decision === "verify" ? "Approval verified." : "Approval sent back." });
}

const decisionSchema = z.object({
  projectId: z.string().min(1),
  action: z.enum(["APPROVE", "REQUEST_CHANGES", "PAUSE", "RESUME", "ARCHIVE"]),
  note: z.string().trim().max(1000).optional(),
});

export async function decideProject(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin/projects", roles: ["ADMIN"] });
  const parsed = decisionSchema.safeParse({
    projectId: formData.get("projectId"),
    action: formData.get("action"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) redirect("/admin/projects");
  const { projectId, action, note } = parsed.data;

  const result = await transitionProject(getDb(), {
    projectId,
    action,
    actor: { id: admin.id, kind: "admin" },
    note,
  });
  if (!result.ok) back(projectId, { error: result.message });

  // After the change is saved. Mail is best-effort and never throws.
  const owners = (
    await getDb().builderMember.findMany({
      where: { builderId: result.project.builderId, role: "OWNER" },
      select: { user: { select: { email: true } } },
    })
  ).map((m) => m.user.email);
  const base = { projectName: result.project.name, projectId };
  if (action === "APPROVE") await sendMail({ to: owners, ...projectApprovedMail(base) });
  if (action === "REQUEST_CHANGES")
    await sendMail({ to: owners, ...projectChangesRequestedMail({ ...base, note: note ?? "" }) });
  if (action === "PAUSE")
    await sendMail({ to: owners, ...projectPausedMail({ ...base, note: note ?? "" }) });

  revalidatePath("/admin", "layout");
  await revalidateProjectPages(getDb(), projectId);
  back(projectId, { saved: "Decision recorded." });
}
