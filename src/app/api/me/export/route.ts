import { getApiUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { exportUserData } from "@/lib/privacy/service";

export const dynamic = "force-dynamic";

// The logged-in person's own data, as a JSON file (their right of access under the DPDP Act). The
// person is the session's user, never an id in the address, so nobody can fetch anyone else's.
export async function GET() {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return new Response("Please log in.", { status: 401 });
  if (auth.status !== "ok") return new Response("Please finish signing in first.", { status: 403 });
  const data = await exportUserData(getDb(), auth.user.id);
  if (!data) return new Response("Not found.", { status: 404 });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rkb-my-data-${stamp}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
