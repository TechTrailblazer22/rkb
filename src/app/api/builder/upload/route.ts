import { revalidateBuilderPages } from "@/lib/projects/revalidate";
import { getDb } from "@/lib/db";
import { createLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { getApiUser } from "@/lib/auth/session";
import { DOCUMENT_SPECS } from "@/lib/builders/documents";
import { editMode } from "@/lib/builders/status";
import { brandingKey, documentKey, getStorage } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, detectFileType, safeFilename } from "@/lib/storage/sniff";
import { StorageNotConfiguredError } from "@/lib/storage/types";
import type { DocumentKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

// Files are stored and (for photos) shown to the public, so a loop of uploads is limited per person.
const limiter = createLimiter({ max: 60, windowMs: 60_000 });

const DOCUMENT_KINDS = new Set<string>(DOCUMENT_SPECS.map((spec) => spec.kind));
const BRANDING = { LOGO: "logo", COVER: "cover" } as const;

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

/**
 * Multipart upload: `kind` is a document kind (private, verification) or LOGO / COVER
 * (public, shown on the builder's profile). The company is found from the signed-in user,
 * never from the request, so nobody can upload into somebody else's account.
 */
export async function POST(request: Request) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return json({ error: "Please log in." }, 401);
  if (auth.status !== "ok") return json({ error: "Please finish signing in first." }, 403);
  const { user } = auth;
  if (limiter.hit(user.id)) {
    return Response.json(
      { error: "Too many uploads. Please wait a little and try again." },
      { status: 429 },
    );
  }

  if (user.role !== "BUILDER_OWNER" && user.role !== "BUILDER_TEAM") {
    return json({ error: "Only builder accounts can upload files." }, 403);
  }

  // Cheap early refusal before reading the whole body.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read. Please try again." }, 400);
  }

  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  const isDocument = DOCUMENT_KINDS.has(kind);
  const isBranding = kind === "LOGO" || kind === "COVER";
  if (!isDocument && !isBranding) return json({ error: "Unknown upload type." }, 400);
  if (!(file instanceof File) || file.size === 0)
    return json({ error: "Choose a file to upload." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);
  }

  const db = getDb();
  const builder = await db.builder.findFirst({
    where: { members: { some: { userId: user.id } } },
    select: {
      id: true,
      status: true,
      logoKey: true,
      coverKey: true,
      members: { where: { userId: user.id }, select: { role: true } },
    },
  });
  if (!builder) return json({ error: "No builder account found." }, 403);
  // The company's documents, logo and cover are the owner's to change.
  if (builder.members[0]?.role !== "OWNER") {
    return json({ error: "Only the owner of the company can change this." }, 403);
  }

  // Documents are legal identity: editable only before submission or after changes are requested.
  // Logo and cover are presentation: a verified builder may change them too.
  const mode = editMode(builder.status);
  const allowed = isDocument ? mode === "full" : mode === "full" || mode === "presentation";
  if (!allowed) {
    return json({ error: "Your application can't be changed in its current state." }, 409);
  }

  const data = Buffer.from(await file.arrayBuffer());
  const detected = detectFileType(data);
  if (!detected) return json({ error: "Upload a PDF, JPG, PNG or WebP file." }, 415);
  if (isBranding && !detected.isImage) {
    return json({ error: "Logo and cover must be a JPG, PNG or WebP image." }, 415);
  }

  let storage;
  try {
    storage = getStorage();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      console.error(error.message);
      return json({ error: "File uploads are not available right now. Please try later." }, 503);
    }
    throw error;
  }

  if (isDocument) {
    const documentKind = kind as DocumentKind;
    const key = documentKey(builder.id, documentKind, detected.ext);
    await storage.put({ key, data, contentType: detected.mime, visibility: "private" });

    let previousKey: string | null = null;
    try {
      const existing = await db.builderDocument.findUnique({
        where: { builderId_kind: { builderId: builder.id, kind: documentKind } },
        select: { storageKey: true },
      });
      previousKey = existing?.storageKey ?? null;

      const fields = {
        storageKey: key,
        originalName: safeFilename(file.name),
        mimeType: detected.mime,
        sizeBytes: data.length,
        status: "PENDING" as const,
        reviewNote: null,
        reviewedAt: null,
        uploadedById: user.id,
        createdAt: new Date(),
      };
      const saved = await db.$transaction(async (tx) => {
        const document = await tx.builderDocument.upsert({
          where: { builderId_kind: { builderId: builder.id, kind: documentKind } },
          create: { builderId: builder.id, kind: documentKind, ...fields },
          update: fields,
        });
        await recordAudit(tx, {
          actorId: user.id,
          action: "document.uploaded",
          entity: "Builder",
          entityId: builder.id,
          meta: { kind: documentKind, replaced: previousKey !== null },
        });
        return document;
      });

      if (previousKey) await storage.remove(previousKey, "private").catch(() => {});
      return json({ ok: true, id: saved.id });
    } catch (error) {
      await storage.remove(key, "private").catch(() => {}); // do not leave an orphan file
      throw error;
    }
  }

  const which = BRANDING[kind as keyof typeof BRANDING];
  const key = brandingKey(builder.id, which, detected.ext);
  await storage.put({ key, data, contentType: detected.mime, visibility: "public" });
  const previousKey = which === "logo" ? builder.logoKey : builder.coverKey;
  try {
    await db.builder.update({
      where: { id: builder.id },
      data: which === "logo" ? { logoKey: key } : { coverKey: key },
    });
  } catch (error) {
    await storage.remove(key, "public").catch(() => {});
    throw error;
  }
  if (previousKey) await storage.remove(previousKey, "public").catch(() => {});
  await revalidateBuilderPages(db, builder.id);
  return json({ ok: true, url: storage.publicUrl(key) });
}
