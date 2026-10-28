import { expireSubscriptions, sendRenewalReminders } from "@/lib/billing/lifecycle";
import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { revalidateBuilderPages } from "@/lib/projects/revalidate";

export const dynamic = "force-dynamic";

// Run once a day (see docs/BILLING.md). Reminds companies whose plan is about to end, and ends the
// plans whose grace days are over (the company drops to the free plan; its projects stay live).
export const { GET, POST } = cronRoute("billing", async () => {
  const db = getDb();
  const reminders = await sendRenewalReminders(db);
  const ended = await expireSubscriptions(db);
  // Priority listing and the home spotlight end with the plan: refresh the pages that show them.
  for (const builderId of ended.expiredBuilderIds) await revalidateBuilderPages(db, builderId);
  return { reminded: reminders.reminded, expired: ended.expired };
});
