import type { ApprovalKind } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getApiUser } from "@/lib/auth/session";
import { entitlementsFor, PLAN_USED_UNTIL_BILLING } from "@/lib/entitlements";
import { findOwnedProject } from "@/lib/projects/context";
import { revalidateProjectPages } from "@/lib/projects/revalidate";
import { approvalDocumentKey, getStorage, projectMediaKey } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, detectFileType, safeFilename } from "@/lib/storage/sniff";
import { StorageNotConfiguredError, type StorageDriver } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });
const APPROVAL_KINDS = new Set(["RERA", "TNCP", "MUNICIPAL", "BANK_LOAN", "OTHER"]);

/**
 * Multipart upload into a project. `kind` is PHOTO, LAYOUT, BROCHURE (public, shown to buyers)
 * or APPROVAL (private; also needs `approval`, the approval type). The project is found through
 * the signed-in builder, so nobody can upload into another builder's project.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/builder/projects/[id]/upload">,
) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return json({ error: "Please log in." }, 401);
  if (auth.status !== "ok") return json({ error: "Please finish signing in first." }, 403);
  const { user } = auth;

  const { id: projectId } = await context.params;
  const owned = await findOwnedProject(user, projectId);
  if (!owned) return json({ error: "Project not found." }, 404);
  const { project, mode } = owned;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024)
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read. Please try again." }, 400);
  }
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!["PHOTO", "LAYOUT", "BROCHURE", "APPROVAL"].includes(kind))
    return json({ error: "Unknown upload type." }, 400);
  if (!(file instanceof File) || file.size === 0)
    return json({ error: "Choose a file to upload." }, 400);
  if (file.size > MAX_UPLOAD_BYTES)
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);

  // Approval documents prove legal facts, so they follow the strict rule. Pictures and brochures
  // may be updated on a live project too.
  const allowed = kind === "APPROVAL" ? mode === "full" : mode !== "locked";
  if (!allowed) return json({ error: "This project can't be changed in its current state." }, 409);

  const data = Buffer.from(await file.arrayBuffer());
  const detected = detectFileType(data);
  if (!detected) return json({ error: "Upload a PDF, JPG, PNG or WebP file." }, 415);
  if (kind === "PHOTO" && !detected.isImage)
    return json({ error: "Photos must be JPG, PNG or WebP images." }, 415);
  if (kind === "BROCHURE" && detected.isImage)
    return json({ error: "The brochure must be a PDF." }, 415);

  const db = getDb();
  const builderId = project.builderId;

  let storage: StorageDriver;
  try {
    storage = getStorage();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      console.error(error.message);
      return json({ error: "File uploads are not available right now. Please try later." }, 503);
    }
    throw error;
  }

  // ---- approval document (private) ----
  if (kind === "APPROVAL") {
    const approvalKind = String(form.get("approval") ?? "");
    if (!APPROVAL_KINDS.has(approvalKind)) return json({ error: "Unknown approval type." }, 400);
    const approval = await db.projectApproval.findUnique({
      where: { projectId_kind: { projectId, kind: approvalKind as ApprovalKind } },
    });
    if (!approval)
      return json({ error: "Save the approval number first, then attach the document." }, 409);

    const key = approvalDocumentKey(builderId, approvalKind, detected.ext);
    await storage.put({ key, data, contentType: detected.mime, visibility: "private" });
    try {
      await db.$transaction(async (tx) => {
        await tx.projectApproval.update({
          where: { id: approval.id },
          data: {
            storageKey: key,
            originalName: safeFilename(file.name),
            mimeType: detected.mime,
            sizeBytes: data.length,
            verified: false,
            verifiedAt: null,
            reviewNote: null, // a new document must be checked again
          },
        });
        await recordAudit(tx, {
          actorId: user.id,
          action: "approval_document.uploaded",
          entity: "Project",
          entityId: projectId,
          meta: { kind: approvalKind },
        });
      });
    } catch (error) {
      await storage.remove(key, "private").catch(() => {});
      throw error;
    }
    if (approval.storageKey) await storage.remove(approval.storageKey, "private").catch(() => {});
    await revalidateProjectPages(db, projectId); // a new document is no longer "verified"
    return json({ ok: true });
  }

  // ---- public media ----
  const mediaKind = kind as "PHOTO" | "LAYOUT" | "BROCHURE";
  if (mediaKind === "PHOTO") {
    const limit = entitlementsFor(PLAN_USED_UNTIL_BILLING).maxPhotosPerProject;
    const count = await db.projectMedia.count({ where: { projectId, kind: "PHOTO" } });
    if (count >= limit)
      return json({ error: `You can add up to ${limit} photos per project on your plan.` }, 409);
  }

  const key = projectMediaKey(
    builderId,
    projectId,
    mediaKind.toLowerCase() as "photo" | "layout" | "brochure",
    detected.ext,
  );
  await storage.put({ key, data, contentType: detected.mime, visibility: "public" });

  let replaced: string[] = [];
  try {
    const created = await db.$transaction(async (tx) => {
      if (mediaKind !== "PHOTO") {
        // one layout plan and one brochure per project: the new file replaces the old
        const old = await tx.projectMedia.findMany({
          where: { projectId, kind: mediaKind },
          select: { id: true, storageKey: true },
        });
        replaced = old.map((o) => o.storageKey);
        if (old.length > 0)
          await tx.projectMedia.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      }
      const hasCover =
        mediaKind === "PHOTO"
          ? (await tx.projectMedia.count({ where: { projectId, kind: "PHOTO", isCover: true } })) >
            0
          : true;
      return tx.projectMedia.create({
        data: {
          projectId,
          kind: mediaKind,
          storageKey: key,
          originalName: safeFilename(file.name),
          mimeType: detected.mime,
          sizeBytes: data.length,
          uploadedById: user.id,
          isCover: mediaKind === "PHOTO" && !hasCover, // the first photo becomes the cover
        },
      });
    });
    for (const old of replaced) await storage.remove(old, "public").catch(() => {});
    await revalidateProjectPages(db, projectId);
    return json({ ok: true, id: created.id, url: storage.publicUrl(key) });
  } catch (error) {
    await storage.remove(key, "public").catch(() => {});
    throw error;
  }
}
