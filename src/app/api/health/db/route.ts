import { getDb } from "@/lib/db";

// Readiness: proves the app can reach Postgres. Not used as Render's health check,
// because a Neon cold start would make Render think the service is down.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "up", latencyMs: Date.now() - started });
  } catch (error) {
    console.error("Database health check failed", error);
    return Response.json({ status: "error", db: "down" }, { status: 503 });
  }
}
