import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { sendMonthlyReports } from "@/lib/jobs/performance";

export const dynamic = "force-dynamic";

// Run once a day (or on the 1st of the month; see docs/LEADS.md). Sends last month's performance
// summary to companies whose plan includes analytics, once each.
export const { GET, POST } = cronRoute("performance", async () => ({
  ...(await sendMonthlyReports(getDb())),
}));
