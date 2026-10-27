import { after } from "next/server";
import { getApiUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { createLimiter } from "@/lib/rate-limit";
import { findOwnedProject } from "@/lib/projects/context";
import { revalidateProjectPages } from "@/lib/projects/revalidate";
import { notifyShortlisters, postProgress } from "@/lib/progress/service";
import { getStorage, projectMediaKey } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, detectFileType } from "@/lib/storage/sniff";
import { StorageNotConfiguredError, type StorageDriver } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

// Files are stored and (for photos) shown to the public, so a loop of uploads is limited per person.
const limiter = createLimiter({ max: 20, windowMs: 3_600_000 });

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

/**
 * Posts a construction update (a note and, optionally, one photo) on a live project. The project is
 * found through the signed-in builder, so nobody can post on another company's project. The people
 * who saved the project are emailed after the response has gone out.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/builder/projects/[id]/progress">,
) {
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

  const { id: projectId } = await context.params;
  const owned = await findOwnedProject(user, projectId);
  if (!owned) return json({ error: "Project not found." }, 404);
  if (owned.mode === "locked" && owned.project.status !== "LIVE") {
    return json({ error: "This project can't be changed right now." }, 409);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ error: "That photo is too large. The limit is 5 MB." }, 413);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The update could not be read. Please try again." }, 400);
  }
  const note = form.get("note");
  const file = form.get("photo");
  if (typeof note !== "string") return json({ error: "Write a note first." }, 400);

  let photoKey: string | null = null;
  let storage: StorageDriver | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: "That photo is too large. The limit is 5 MB." }, 413);
    }
    const data = Buffer.from(await file.arrayBuffer());
    const detected = detectFileType(data);
    if (!detected?.isImage)
      return json({ error: "The photo must be a JPG, PNG or WebP image." }, 415);
    try {
      storage = getStorage();
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        console.error(error.message);
        return json({ error: "Photo uploads are not available right now. Please try later." }, 503);
      }
      throw error;
    }
    photoKey = projectMediaKey(owned.project.builderId, projectId, "progress", detected.ext);
    await storage.put({ key: photoKey, data, contentType: detected.mime, visibility: "public" });
  }

  const db = getDb();
  const result = await postProgress(db, {
    projectId,
    builderId: owned.project.builderId,
    actorId: user.id,
    note,
    photoKey,
  });
  if (!result.ok) {
    if (photoKey && storage) await storage.remove(photoKey, "public").catch(() => {});
    return json({ error: result.message }, result.code === "too_many" ? 429 : 400);
  }

  await revalidateProjectPages(db, projectId);
  // Emailing can take a while (up to a couple of hundred messages): do it after answering.
  after(async () => {
    try {
      await notifyShortlisters(db, result.update.id);
    } catch (error) {
      console.error("Could not notify people about a progress update", error);
    }
  });
  return json({ ok: true, id: result.update.id });
}
