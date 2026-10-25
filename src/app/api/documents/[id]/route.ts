import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getApiUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { FileNotFoundError } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

// Verification documents are private. This is the only way to open one: it checks that the
// caller is an admin or a member of the owning company, then hands out the file with a link that
// expires in minutes (or the bytes, with the local development driver).
const LINK_LIFETIME_SECONDS = 300;

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_request: Request, context: RouteContext<"/api/documents/[id]">) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return new Response("Please log in.", { status: 401 });
  if (auth.status !== "ok") return new Response("Please finish signing in first.", { status: 403 });
  const { user } = auth;

  const { id } = await context.params;
  const db = getDb();
  const document = await db.builderDocument.findUnique({
    where: { id },
    select: { id: true, builderId: true, kind: true, storageKey: true, originalName: true },
  });
  if (!document) return notFound();

  const isAdmin = user.role === "ADMIN";
  const isMember = user.builderIds.includes(document.builderId);
  // Same answer as "does not exist", so document ids cannot be probed.
  if (!isAdmin && !isMember) return notFound();

  if (isAdmin) {
    await recordAudit(db, {
      actorId: user.id,
      action: "document.viewed",
      entity: "Builder",
      entityId: document.builderId,
      meta: { documentId: document.id, kind: document.kind },
    });
  }

  try {
    const result = await getStorage().read(document.storageKey, "private", LINK_LIFETIME_SECONDS);
    if (result.kind === "redirect") {
      return new Response(null, {
        status: 302,
        headers: { Location: result.url, "Cache-Control": "private, no-store" },
      });
    }
    const filename = encodeURIComponent(document.originalName);
    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // The file is shown as a plain document and can never run anything.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof FileNotFoundError) return notFound();
    throw error;
  }
}
