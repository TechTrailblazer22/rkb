"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateBuilderPages } from "@/lib/projects/revalidate";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseAdminEmails } from "@/lib/auth/roles";
import { requireBuilderContext } from "@/lib/builders/context";
import { parseProfileInput } from "@/lib/builders/profile";
import { nextStatus } from "@/lib/builders/status";
import { sendMail } from "@/lib/mail";
import { adminNewSubmissionMail, builderSubmittedMail } from "@/lib/mail/templates";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanCode } from "@/generated/prisma/enums";
import { plans } from "@/lib/plans";

export type SaveProfileResult =
  { ok: true; savedAt: string; errors: Record<string, string> } | { ok: false; message: string };

/**
 * Autosave for the company profile. Every valid field is saved; invalid ones come back as
 * errors and are left untouched, so a typo in one box never blocks the rest.
 */
export async function saveProfile(input: Record<string, string>): Promise<SaveProfileResult> {
  const ctx = await requireBuilderContext("/portal/profile");
  const { updates, errors } = parseProfileInput(input, ctx.mode);

  if (Object.keys(updates).length > 0) {
    await getDb().builder.update({
      where: { id: ctx.builder.id },
      // Every key and value here was produced by the per-field validators in profile.ts.
      data: updates as Prisma.BuilderUpdateInput,
    });
    // A verified builder's public page shows the profile, so refresh it.
    if (ctx.builder.status === "VERIFIED") await revalidateBuilderPages(getDb(), ctx.builder.id);
  }
  return { ok: true, savedAt: new Date().toISOString(), errors };
}

/** Records which plan the builder is interested in. No payment happens here. */
export async function choosePlan(formData: FormData) {
  const ctx = await requireBuilderContext("/portal/plan");
  const code = String(formData.get("plan") ?? "");
  const valid = plans.some((plan) => plan.code === code);
  if (!valid) redirect("/portal/plan?error=choose");
  if (ctx.mode === "locked") redirect("/portal/plan");

  await getDb().builder.update({
    where: { id: ctx.builder.id },
    data: { interestedPlan: code as PlanCode },
  });
  revalidatePath("/portal", "layout");
  redirect("/portal/review");
}

export type SubmitResult = { ok: false; message: string } | null;

/** Sends the application for review, after checking again on the server that it is complete. */
export async function submitForVerification(_previous: SubmitResult): Promise<SubmitResult> {
  const ctx = await requireBuilderContext("/portal/review");

  const target = nextStatus(ctx.builder.status, "SUBMIT");
  if (!target) return { ok: false, message: "This application cannot be submitted right now." };
  if (!ctx.checklist.canSubmit) {
    return {
      ok: false,
      message: "Some required items are still missing. Please complete them first.",
    };
  }

  const db = getDb();
  await db.$transaction(async (tx) => {
    // Compare-and-set on the status, so a double click cannot submit twice.
    const changed = await tx.builder.updateMany({
      where: { id: ctx.builder.id, status: ctx.builder.status },
      data: { status: target, submittedAt: new Date(), reviewNote: null },
    });
    if (changed.count !== 1) throw new Error("Application status changed during submit.");
    await recordAudit(tx, {
      actorId: ctx.user.id,
      action: "builder.submitted",
      entity: "Builder",
      entityId: ctx.builder.id,
      meta: { from: ctx.builder.status, to: target },
    });
  });

  // After the data is safely saved. Mail is best-effort and never throws.
  await sendMail({
    to: ctx.user.email,
    ...builderSubmittedMail({ companyName: ctx.builder.companyName }),
  });
  await sendMail({
    to: parseAdminEmails(process.env.ADMIN_EMAILS),
    ...adminNewSubmissionMail({
      companyName: ctx.builder.companyName,
      ownerEmail: ctx.user.email,
      builderId: ctx.builder.id,
    }),
  });

  revalidatePath("/portal", "layout");
  redirect("/portal");
}
