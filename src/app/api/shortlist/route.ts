import { z } from "zod";
import { getDb } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { listShortlistIds, setShortlisted } from "@/lib/shortlist/service";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: noStore });

/**
 * The signed-in user's saved projects, as ids. A visitor who is not logged in gets
 * `authenticated: false`, which is not an error: the page then sends them to log in when they
 * press a heart. One request serves every heart on a page.
 */
export async function GET() {
  const auth = await getApiUser();
  if (auth.status !== "ok") return json({ authenticated: false, ids: [] });
  return json({ authenticated: true, ids: await listShortlistIds(getDb(), auth.user.id) });
}

const body = z.object({ projectId: z.string().min(1).max(60), saved: z.boolean() });

export async function POST(request: Request) {
  // Only our own pages send JSON. A form posted from another site cannot, so this also blocks
  // cross-site requests that ride on the visitor's cookie.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "Unsupported request." }, 415);
  }
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return json({ error: "Please log in." }, 401);
  if (auth.status !== "ok") return json({ error: "Please finish signing in first." }, 403);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);

  const result = await setShortlisted(getDb(), { userId: auth.user.id, ...parsed.data });
  if (!result.ok) return json({ error: "That project is not available." }, 404);
  return json({ ok: true, saved: result.saved });
}
