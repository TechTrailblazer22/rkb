import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { processApprovalExpiry } from "@/lib/jobs/approval-expiry";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

export const dynamic = "force-dynamic";

// Run once a day (see docs/LEADS.md). Warns about approvals that are about to expire and pauses
// projects whose approval has expired.
export const { GET, POST } = cronRoute("approvals", async () => {
  const db = getDb();
  const result = await processApprovalExpiry(db);
  // A paused project must disappear from the cached public pages straight away.
  for (const id of result.pausedProjectIds) await revalidateProjectPages(db, id);
  return { warned: result.warned, paused: result.paused };
});
