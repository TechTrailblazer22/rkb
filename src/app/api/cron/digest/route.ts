import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { sendDailyDigests } from "@/lib/jobs/digest";

export const dynamic = "force-dynamic";

// Run once a day (see docs/LEADS.md). Emails each company a summary of new enquiries.
export const { GET, POST } = cronRoute("digest", () => sendDailyDigests(getDb()));
