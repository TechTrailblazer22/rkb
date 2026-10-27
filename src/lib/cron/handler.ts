import { checkCronAccess } from "@/lib/cron/auth";

/**
 * Wraps a scheduled job as a route handler: secret check, then the job, then a small JSON report.
 * A job that throws answers 500 and says only that it failed (details go to the server log), so the
 * scheduler's history shows the failure without leaking anything.
 */
export function cronRoute(name: string, job: () => Promise<Record<string, unknown>>) {
  async function handle(request: Request) {
    const access = checkCronAccess(request.headers);
    if (access === "disabled") {
      return Response.json(
        { error: "Scheduled jobs are not configured (CRON_SECRET)." },
        { status: 503 },
      );
    }
    if (access === "denied") return Response.json({ error: "Not allowed." }, { status: 401 });
    try {
      return Response.json(
        { job: name, ...(await job()) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.error(`Scheduled job ${name} failed`, error);
      return Response.json({ job: name, error: "The job failed." }, { status: 500 });
    }
  }
  return { GET: handle, POST: handle };
}
