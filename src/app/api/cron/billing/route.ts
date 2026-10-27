import { expireSubscriptions, sendRenewalReminders } from "@/lib/billing/lifecycle";
import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

export const dynamic = "force-dynamic";

// Run once a day (see docs/BILLING.md). Reminds companies whose plan is about to end, and ends the
// plans whose grace days are over, taking those companies' live projects offline.
export const { GET, POST } = cronRoute("billing", async () => {
  const db = getDb();
  const reminders = await sendRenewalReminders(db);
  const ended = await expireSubscriptions(db);
  // A paused project must disappear from the cached public pages straight away.
  for (const id of ended.pausedProjectIds) await revalidateProjectPages(db, id);
  return {
    reminded: reminders.reminded,
    expired: ended.expired,
    paused: ended.pausedProjectIds.length,
  };
});
