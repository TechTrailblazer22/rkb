import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getApiUser } from "@/lib/auth/session";
import { servePrivateFile } from "@/lib/storage/serve";

export const dynamic = "force-dynamic";

// The certificate attached to a project approval (RERA, TNCP...). Private, like the company's
// verification documents: only that builder's team and admins can open it.
const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_request: Request, context: RouteContext<"/api/project-documents/[id]">) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return new Response("Please log in.", { status: 401 });
  if (auth.status !== "ok") return new Response("Please finish signing in first.", { status: 403 });
  const { user } = auth;

  const { id } = await context.params;
  const db = getDb();
  const approval = await db.projectApproval.findUnique({
    where: { id },
    include: { project: { select: { id: true, builderId: true } } },
  });
  if (!approval?.storageKey) return notFound();

  const isAdmin = user.role === "ADMIN";
  const isMember = user.builderIds.includes(approval.project.builderId);
  if (!isAdmin && !isMember) return notFound(); // same answer as "does not exist"

  if (isAdmin) {
    await recordAudit(db, {
      actorId: user.id,
      action: "approval_document.viewed",
      entity: "Project",
      entityId: approval.project.id,
      meta: { approvalId: approval.id, kind: approval.kind },
    });
  }
  return servePrivateFile(approval.storageKey, approval.originalName ?? "approval");
}
