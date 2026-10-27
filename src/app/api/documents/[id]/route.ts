import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getApiUser } from "@/lib/auth/session";
import { servePrivateFile } from "@/lib/storage/serve";

export const dynamic = "force-dynamic";

// Verification documents are private. This is the only way to open one: it checks that the
// caller is an admin or the owner of the company, then serves it through servePrivateFile.

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
  // The company's identity documents (PAN, GST, ...) are the owner's: a manager or staff member of
  // the company does not see them. Same answer as "does not exist", so ids cannot be probed.
  const isOwner =
    !isAdmin &&
    user.builderIds.includes(document.builderId) &&
    (await db.builderMember.findFirst({
      where: { builderId: document.builderId, userId: user.id, role: "OWNER" },
      select: { id: true },
    })) !== null;
  if (!isAdmin && !isOwner) return notFound();

  if (isAdmin) {
    await recordAudit(db, {
      actorId: user.id,
      action: "document.viewed",
      entity: "Builder",
      entityId: document.builderId,
      meta: { documentId: document.id, kind: document.kind },
    });
  }

  return servePrivateFile(document.storageKey, document.originalName);
}
