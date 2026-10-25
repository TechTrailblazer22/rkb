"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import type { ApprovalKind } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { parseAdminEmails } from "@/lib/auth/roles";
import { requireBuilderContext } from "@/lib/builders/context";
import { entitlementsForBuilder } from "@/lib/entitlements";
import { sendMail } from "@/lib/mail";
import { projectSubmittedAdminMail } from "@/lib/mail/templates";
import { deletePlots, setPlotStatuses, addPlots, updatePlot } from "@/lib/plots/service";
import { parsePlotRow } from "@/lib/plots/row";
import { buildSeries } from "@/lib/plots/series";
import { requireProjectContext } from "@/lib/projects/context";
import { PROJECT_FIELDS, parseProjectInput, type FormStep } from "@/lib/projects/fields";
import { createProject, transitionProject } from "@/lib/projects/service";
import type { ProjectAction } from "@/lib/projects/status";
import { getStorage } from "@/lib/storage";

export type SaveStepResult =
  { ok: true; savedAt: string; errors: Record<string, string> } | { ok: false; message: string };

const FORM_STEPS: FormStep[] = [
  "basics",
  "layout",
  "approvals",
  "timeline",
  "pricing",
  "amenities",
  "media",
  "contact",
];

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** Redirect to a page of the project, with a message to show. */
function backTo(
  projectId: string,
  step: string,
  message?: { saved?: string; error?: string },
): never {
  const query = new URLSearchParams(message as Record<string, string> | undefined).toString();
  redirect(`/portal/projects/${projectId}/${step}${query ? `?${query}` : ""}`);
}

// ---------------------------------------------------------------------------------------

export async function createProjectAction(formData: FormData) {
  const ctx = await requireBuilderContext("/portal/projects");
  if (ctx.builder.status === "SUSPENDED" || ctx.builder.status === "REJECTED") {
    redirect(
      "/portal/projects?error=" + encodeURIComponent("Your company cannot add projects right now."),
    );
  }

  const result = await createProject(getDb(), {
    builderId: ctx.builder.id,
    actorId: ctx.user.id,
    name: text(formData, "name"),
    type: text(formData, "type"),
    entitlements: entitlementsForBuilder(ctx.builder),
  });
  if (!result.ok) redirect("/portal/projects?error=" + encodeURIComponent(result.message));

  revalidatePath("/portal/projects");
  redirect(`/portal/projects/${result.project.id}/basics`);
}

// ---------------------------------------------------------------------------------------

/** Autosave for one wizard step. Valid fields are saved; invalid ones come back as errors. */
export async function saveProjectStep(
  projectId: string,
  step: string,
  values: Record<string, string>,
): Promise<SaveStepResult> {
  if (!FORM_STEPS.includes(step as FormStep)) return { ok: false, message: "Unknown step." };
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/${step}`);

  const { updates, errors } = parseProjectInput(step as FormStep, values, ctx.projectMode);

  if (updates.videoUrl && !ctx.entitlements.video) {
    delete updates.videoUrl;
    errors.videoUrl = "Videos are available on the Growth plan and above.";
  }

  if (Object.keys(updates).length > 0) {
    await getDb().project.update({
      where: { id: ctx.project.id },
      // Each key and value was produced by the per-field validators in fields.ts.
      data: updates as Prisma.ProjectUpdateInput,
    });
  }
  return { ok: true, savedAt: new Date().toISOString(), errors };
}

// ---------------------------------------------------------------------------------------
// Approvals

const APPROVAL_KINDS: ApprovalKind[] = ["RERA", "TNCP", "MUNICIPAL", "BANK_LOAN", "OTHER"];
const APPROVAL_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 /\-.()]{2,59}$/;

export async function saveApproval(formData: FormData) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/approvals`);
  const kind = text(formData, "kind") as ApprovalKind;
  if (!APPROVAL_KINDS.includes(kind))
    backTo(projectId, "approvals", { error: "Unknown approval type." });
  if (ctx.projectMode !== "full") {
    backTo(projectId, "approvals", {
      error:
        ctx.projectMode === "cosmetic"
          ? "Approvals are locked while the project is live. Use Edit and resubmit to change them."
          : "Approvals can't be changed right now.",
    });
  }

  const number = text(formData, "number").trim().replace(/\s+/g, " ");
  if (!APPROVAL_NUMBER.test(number)) {
    backTo(projectId, "approvals", {
      error: "Enter the approval number exactly as it appears on the certificate.",
    });
  }

  const dates: Record<"validFrom" | "validTill", Date | null> = {
    validFrom: null,
    validTill: null,
  };
  for (const key of ["validFrom", "validTill"] as const) {
    const raw = text(formData, key).trim();
    if (!raw) continue;
    const parsed = PROJECT_FIELDS.startDate.parse(raw);
    if (!parsed.ok)
      backTo(projectId, "approvals", { error: "Enter valid dates for the approval." });
    dates[key] = parsed.value as Date;
  }
  if (dates.validFrom && dates.validTill && dates.validTill < dates.validFrom) {
    backTo(projectId, "approvals", { error: "The approval's end date is before its start date." });
  }

  const db = getDb();
  const existing = await db.projectApproval.findUnique({
    where: { projectId_kind: { projectId, kind } },
  });
  // Changing what was verified means it must be verified again.
  const changed =
    !existing ||
    existing.number !== number ||
    existing.validTill?.getTime() !== dates.validTill?.getTime();

  await db.projectApproval.upsert({
    where: { projectId_kind: { projectId, kind } },
    create: { projectId, kind, number, ...dates },
    update: {
      number,
      ...dates,
      ...(changed ? { verified: false, verifiedAt: null, reviewNote: null } : {}),
    },
  });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "approvals", { saved: kind });
}

export async function deleteApproval(formData: FormData) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/approvals`);
  if (ctx.projectMode !== "full")
    backTo(projectId, "approvals", { error: "Approvals can't be changed right now." });

  const db = getDb();
  const approval = await db.projectApproval.findFirst({
    where: { projectId, kind: text(formData, "kind") as ApprovalKind },
  });
  if (approval) {
    await db.projectApproval.delete({ where: { id: approval.id } });
    if (approval.storageKey)
      await getStorage()
        .remove(approval.storageKey, "private")
        .catch(() => {});
  }
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "approvals", { saved: "removed" });
}

// ---------------------------------------------------------------------------------------
// Media

export async function setCoverPhoto(formData: FormData) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/media`);
  if (ctx.projectMode === "locked")
    backTo(projectId, "media", { error: "Photos can't be changed right now." });

  const db = getDb();
  const photo = await db.projectMedia.findFirst({
    where: { id: text(formData, "mediaId"), projectId, kind: "PHOTO" },
    select: { id: true },
  });
  if (photo) {
    await db.$transaction([
      db.projectMedia.updateMany({ where: { projectId, kind: "PHOTO" }, data: { isCover: false } }),
      db.projectMedia.update({ where: { id: photo.id }, data: { isCover: true } }),
    ]);
  }
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "media", { saved: "cover" });
}

export async function deleteMedia(formData: FormData) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/media`);
  if (ctx.projectMode === "locked")
    backTo(projectId, "media", { error: "Photos can't be changed right now." });

  const db = getDb();
  const media = await db.projectMedia.findFirst({
    where: { id: text(formData, "mediaId"), projectId },
  });
  if (media) {
    await db.projectMedia.delete({ where: { id: media.id } });
    await getStorage()
      .remove(media.storageKey, "public")
      .catch(() => {});
    if (media.isCover) {
      // The next photo takes over as the cover, so the listing is never without one.
      const next = await db.projectMedia.findFirst({
        where: { projectId, kind: "PHOTO" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) await db.projectMedia.update({ where: { id: next.id }, data: { isCover: true } });
    }
  }
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "media", { saved: "removed" });
}

// ---------------------------------------------------------------------------------------
// Plots

/** The plot form's fields, in the shape parsePlotRow understands. */
function rawPlot(formData: FormData): Record<string, unknown> {
  return {
    number: text(formData, "number"),
    sizeSqft: text(formData, "sizeSqft"),
    dimensions: text(formData, "dimensions"),
    facing: text(formData, "facing"),
    corner: formData.get("corner") === "on" ? "yes" : "no",
    roadWidthFt: text(formData, "roadWidthFt"),
    ratePerSqft: text(formData, "ratePerSqft"),
    price: text(formData, "price"),
    status: text(formData, "status"),
    phase: text(formData, "phase"),
    unitType: text(formData, "unitType"),
    builtUpSqft: text(formData, "builtUpSqft"),
  };
}

async function plotContext(formData: FormData) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/plots`);
  if (ctx.projectMode === "locked")
    backTo(projectId, "plots", { error: "Plots can't be changed right now." });
  return { ctx, projectId };
}

export async function addPlotAction(formData: FormData) {
  const { ctx, projectId } = await plotContext(formData);
  const parsed = parsePlotRow(rawPlot(formData));
  if (!parsed.ok) backTo(projectId, "plots", { error: parsed.errors.join(" ") });

  const result = await addPlots(getDb(), {
    projectId,
    actorId: ctx.user.id,
    plots: [parsed.value],
    via: "manual",
  });
  if (!result.ok) backTo(projectId, "plots", { error: result.message });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "plots", { saved: `Plot ${parsed.value.number} added.` });
}

export async function updatePlotAction(formData: FormData) {
  const { ctx, projectId } = await plotContext(formData);
  const parsed = parsePlotRow(rawPlot(formData));
  if (!parsed.ok) backTo(projectId, "plots", { error: parsed.errors.join(" ") });

  const result = await updatePlot(getDb(), {
    projectId,
    plotId: text(formData, "plotId"),
    plot: parsed.value,
    actorId: ctx.user.id,
  });
  if (!result.ok) backTo(projectId, "plots", { error: result.message });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "plots", { saved: `Plot ${parsed.value.number} updated.` });
}

/** Status buttons and delete for the ticked plots in the table. */
export async function bulkPlotsAction(formData: FormData) {
  const { ctx, projectId } = await plotContext(formData);
  const ids = formData.getAll("plotId").filter((v): v is string => typeof v === "string");
  if (ids.length === 0) backTo(projectId, "plots", { error: "Tick at least one plot first." });
  const action = text(formData, "bulk");

  if (action === "DELETE") {
    const { deleted } = await deletePlots(getDb(), {
      projectId,
      plotIds: ids,
      actorId: ctx.user.id,
    });
    revalidatePath(`/portal/projects/${projectId}`, "layout");
    backTo(projectId, "plots", {
      saved: `${deleted} ${deleted === 1 ? "plot" : "plots"} deleted.`,
    });
  }
  if (action === "AVAILABLE" || action === "BOOKED" || action === "SOLD") {
    const { changed, skipped } = await setPlotStatuses(getDb(), {
      projectId,
      plotIds: ids,
      status: action,
      actorId: ctx.user.id,
      via: "bulk",
    });
    revalidatePath(`/portal/projects/${projectId}`, "layout");
    backTo(projectId, "plots", {
      saved: `${changed} ${changed === 1 ? "plot" : "plots"} marked ${action.toLowerCase()}${skipped ? ` (${skipped} unchanged)` : ""}.`,
    });
  }
  backTo(projectId, "plots", { error: "Choose what to do with the ticked plots." });
}

/** One plot's status, from the dropdown in its row. Returns a result instead of redirecting. */
export async function setPlotStatusAction(
  projectId: string,
  plotId: string,
  status: string,
): Promise<{ ok: boolean; message: string }> {
  if (status !== "AVAILABLE" && status !== "BOOKED" && status !== "SOLD") {
    return { ok: false, message: "Unknown status." };
  }
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/plots`);
  if (ctx.projectMode === "locked")
    return { ok: false, message: "Plots can't be changed right now." };

  const { changed } = await setPlotStatuses(getDb(), {
    projectId,
    plotIds: [plotId],
    status,
    actorId: ctx.user.id,
    via: "manual",
  });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  return changed > 0 ? { ok: true, message: "Saved" } : { ok: false, message: "Not changed" };
}

export async function generateSeriesAction(formData: FormData) {
  const { ctx, projectId } = await plotContext(formData);
  const series = buildSeries({
    prefix: text(formData, "prefix"),
    start: Number(text(formData, "start")),
    end: Number(text(formData, "end")),
    padTo: Number(text(formData, "padTo") || 0),
    sizeSqft: text(formData, "sizeSqft"),
    dimensions: text(formData, "dimensions"),
    facing: text(formData, "facing"),
    ratePerSqft: text(formData, "ratePerSqft"),
    phase: text(formData, "phase"),
  });
  if (!series.ok) backTo(projectId, "plots", { error: series.error });

  const result = await addPlots(getDb(), {
    projectId,
    actorId: ctx.user.id,
    plots: series.plots,
    via: "series",
  });
  if (!result.ok) backTo(projectId, "plots", { error: result.message });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "plots", { saved: `${result.created} plots created.` });
}

// ---------------------------------------------------------------------------------------
// Status changes

export type SubmitState = { ok: false; message: string } | null;

export async function submitProject(
  projectId: string,
  _previous: SubmitState,
): Promise<SubmitState> {
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/review`);
  const result = await transitionProject(getDb(), {
    projectId,
    action: "SUBMIT",
    actor: { id: ctx.user.id, kind: "builder" },
    builderId: ctx.builder.id,
  });
  if (!result.ok) return { ok: false, message: result.message };

  await sendMail({
    to: parseAdminEmails(process.env.ADMIN_EMAILS),
    ...projectSubmittedAdminMail({
      projectName: ctx.project.name,
      companyName: ctx.builder.companyName,
      projectId,
    }),
  });
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  backTo(projectId, "review", { saved: "submitted" });
}

async function simpleTransition(formData: FormData, action: ProjectAction, done: string) {
  const projectId = text(formData, "projectId");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/review`);
  const result = await transitionProject(getDb(), {
    projectId,
    action,
    actor: { id: ctx.user.id, kind: "builder" },
    builderId: ctx.builder.id,
  });
  if (!result.ok) backTo(projectId, "review", { error: result.message });
  revalidatePath("/portal/projects");
  revalidatePath(`/portal/projects/${projectId}`, "layout");
  if (action === "ARCHIVE") redirect("/portal/projects");
  backTo(projectId, "basics", { saved: done });
}

/** Take a live listing offline so that its legal details can be edited. */
export async function reopenProject(formData: FormData) {
  await simpleTransition(formData, "REOPEN", "reopened");
}

export async function archiveProject(formData: FormData) {
  await simpleTransition(formData, "ARCHIVE", "archived");
}
