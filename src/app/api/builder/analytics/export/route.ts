import { getApiUser } from "@/lib/auth/session";
import { statsToCsv } from "@/lib/analytics/stats";
import { getDb } from "@/lib/db";
import { entitlementsForBuilder } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

// The company's analytics as a CSV file (Premier). The company comes from the logged-in user's
// membership, never from the address.
export async function GET() {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return new Response("Please log in.", { status: 401 });
  if (auth.status !== "ok") return new Response("Please finish signing in first.", { status: 403 });
  if (auth.user.role !== "BUILDER_OWNER" && auth.user.role !== "BUILDER_TEAM") {
    return new Response("Only builder accounts can export analytics.", { status: 403 });
  }
  const db = getDb();
  const membership = await db.builderMember.findFirst({
    where: { userId: auth.user.id },
    select: { builderId: true },
  });
  if (!membership) return new Response("No builder account.", { status: 403 });
  if ((await entitlementsForBuilder(db, membership.builderId)).analytics !== "export") {
    return new Response("CSV export is part of the Premier plan.", { status: 403 });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(await statsToCsv(db, membership.builderId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rkb-analytics-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
