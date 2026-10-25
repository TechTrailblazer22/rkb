// Liveness only: no database access. Used by Render's health check and the
// UptimeRobot keep-warm ping, so it must stay fast and never fail on a DB blip.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", time: new Date().toISOString() });
}
