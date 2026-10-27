import { cronRoute } from "@/lib/cron/handler";
import { getDb } from "@/lib/db";
import { sendFollowUpReminders } from "@/lib/jobs/follow-ups";

export const dynamic = "force-dynamic";

// Run every 15 minutes (see docs/LEADS.md). Emails the follow-ups that have come due.
export const { GET, POST } = cronRoute("reminders", () => sendFollowUpReminders(getDb()));
