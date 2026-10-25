"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { REQUIRED_DOCUMENT_KINDS } from "@/lib/builders/documents";
import { buildChecklist } from "@/lib/builders/profile";
import { uniqueSlug } from "@/lib/builders/slug";
import { nextStatus, type BuilderAction } from "@/lib/builders/status";
import { sendMail } from "@/lib/mail";
import {
  builderApprovedMail,
  builderChangesRequestedMail,
  builderRejectedMail,
} from "@/lib/mail/templates";

const NOTE_MIN = 10;
const NOTE_MAX = 1000;

function back(builderId: string, params: Record<string, string> = {}): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/admin/builders/${builderId}${query ? `?${query}` : ""}`);
}

const reviewSchema = z.object({
  builderId: z.string().min(1),
  documentId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

/** Approve a document, or send it back with a note saying what is wrong. */
export async function reviewDocument(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });
  const parsed = reviewSchema.safeParse({
    builderId: formData.get("builderId"),
    documentId: formData.get("documentId"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) redirect("/admin/builders");
  const { builderId, documentId, decision, note } = parsed.data;

  if (decision === "reject" && (!note || note.length < NOTE_MIN)) {
    back(builderId, {
      error: `Add a note of at least ${NOTE_MIN} characters so the builder knows what to fix.`,
    });
  }

  const db = getDb();
  const document = await db.builderDocument.findFirst({
    where: { id: documentId, builderId },
    include: { builder: { select: { status: true } } },
  });
  if (!document) back(builderId, { error: "That document no longer exists." });
  if (document.builder.status !== "SUBMITTED") {
    back(builderId, {
      error: "Documents can only be reviewed while the application is under review.",
    });
  }

  await db.$transaction(async (tx) => {
    await tx.builderDocument.update({
      where: { id: documentId },
      data: {
        status: decision === "approve" ? "APPROVED" : "REJECTED",
        reviewNote: decision === "reject" ? note : null,
        reviewedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: admin.id,
      action: decision === "approve" ? "document.approved" : "document.rejected",
      entity: "Builder",
      entityId: builderId,
      meta: { documentId, kind: document.kind, ...(note ? { note } : {}) },
    });
  });

  revalidatePath(`/admin/builders/${builderId}`);
  back(builderId, { saved: decision === "approve" ? "Document approved." : "Document sent back." });
}

const decisionSchema = z.object({
  builderId: z.string().min(1),
  action: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT", "SUSPEND", "REINSTATE"]),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

const NOTE_REQUIRED: BuilderAction[] = ["REQUEST_CHANGES", "REJECT", "SUSPEND"];

/** Decide an application: approve, ask for changes, reject, or suspend/reinstate a verified builder. */
export async function decideBuilder(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });
  const parsed = decisionSchema.safeParse({
    builderId: formData.get("builderId"),
    action: formData.get("action"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) redirect("/admin/builders");
  const { builderId, action, note } = parsed.data;

  if (NOTE_REQUIRED.includes(action) && (!note || note.length < NOTE_MIN)) {
    back(builderId, {
      error: `Add a note of at least ${NOTE_MIN} characters explaining the decision.`,
    });
  }

  const db = getDb();
  const builder = await db.builder.findUnique({
    where: { id: builderId },
    include: {
      documents: true,
      members: { where: { role: "OWNER" }, include: { user: { select: { email: true } } } },
    },
  });
  if (!builder) redirect("/admin/builders");

  const target = nextStatus(builder.status, action);
  if (!target)
    back(builderId, { error: "That action is not available for this application's status." });

  if (action === "APPROVE") {
    const checklist = buildChecklist(builder, builder.documents);
    if (!checklist.profile.done) {
      back(builderId, {
        error: "The company profile is incomplete or inconsistent, so it cannot be approved.",
      });
    }
    const approved = new Set(
      builder.documents.filter((d) => d.status === "APPROVED").map((d) => d.kind),
    );
    const unapproved = REQUIRED_DOCUMENT_KINDS.filter((kind) => !approved.has(kind));
    if (unapproved.length > 0) {
      back(builderId, { error: "Approve every required document before approving the builder." });
    }
  }

  const now = new Date();
  const slug =
    action === "APPROVE" && !builder.slug
      ? await uniqueSlug(
          builder.companyName ?? "builder",
          async (candidate) => (await db.builder.count({ where: { slug: candidate } })) > 0,
        )
      : undefined;

  await db.$transaction(async (tx) => {
    // Compare-and-set on the status: if another admin decided first, this changes nothing.
    const changed = await tx.builder.updateMany({
      where: { id: builderId, status: builder.status },
      data: {
        status: target,
        reviewedAt: now,
        reviewedById: admin.id,
        reviewNote: action === "APPROVE" || action === "REINSTATE" ? null : (note ?? null),
        ...(action === "APPROVE" ? { verifiedAt: now, ...(slug ? { slug } : {}) } : {}),
      },
    });
    if (changed.count !== 1) throw new Error("Application status changed during review.");
    await recordAudit(tx, {
      actorId: admin.id,
      action: `builder.${action.toLowerCase()}`,
      entity: "Builder",
      entityId: builderId,
      meta: { from: builder.status, to: target, ...(note ? { note } : {}) },
    });
  });

  // After commit, best-effort.
  const owners = builder.members.map((member) => member.user.email);
  if (action === "APPROVE") {
    await sendMail({ to: owners, ...builderApprovedMail({ companyName: builder.companyName }) });
  } else if (action === "REQUEST_CHANGES") {
    await sendMail({
      to: owners,
      ...builderChangesRequestedMail({ companyName: builder.companyName, note: note ?? "" }),
    });
  } else if (action === "REJECT") {
    await sendMail({
      to: owners,
      ...builderRejectedMail({ companyName: builder.companyName, note: note ?? "" }),
    });
  }

  revalidatePath("/admin", "layout");
  back(builderId, { saved: "Decision recorded." });
}
