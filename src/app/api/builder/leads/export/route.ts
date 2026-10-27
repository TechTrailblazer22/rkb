import type { NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { entitlementsForBuilder } from "@/lib/entitlements";
import { leadsToCsv } from "@/lib/leads/csv";
import { leadsForExport } from "@/lib/leads/service";
import { parseLeadStatus } from "@/lib/leads/status";

export const dynamic = "force-dynamic";

// The builder's leads as a CSV file, with the same filters as the inbox. The company comes from the
// logged-in user's membership, never from the address.
export async function GET(request: NextRequest) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return new Response("Please log in.", { status: 401 });
  if (auth.status !== "ok") return new Response("Please finish signing in first.", { status: 403 });
  const { user } = auth;
  if (user.role !== "BUILDER_OWNER" && user.role !== "BUILDER_TEAM") {
    return new Response("Only builder accounts can export leads.", { status: 403 });
  }

  const db = getDb();
  const membership = await db.builderMember.findFirst({
    where: { userId: user.id },
    select: { builderId: true },
  });
  if (!membership) return new Response("No builder account.", { status: 403 });

  if ((await entitlementsForBuilder(db, membership.builderId)).leads !== "full") {
    return new Response("CSV export is part of the Growth plan and above.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const rows = await leadsForExport(db, membership.builderId, {
    status: parseLeadStatus(params.get("status")),
    projectId: params.get("project") || null,
    q: params.get("q") ?? "",
    due: params.get("due") === "1",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(leadsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rkb-leads-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
