import { getSessionUser } from "@/lib/auth/session";

// Tells the static site header whether the visitor is logged in, so public pages can
// stay cacheable. Reads the session cookie only, no database access.
export const dynamic = "force-dynamic";

export async function GET() {
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
  } catch (error) {
    // A broken session must never break the header: treat it as logged out.
    console.error("Could not read session for /api/me", error);
  }

  return Response.json(
    {
      authenticated: Boolean(user),
      emailVerified: user?.email_verified === true,
      name: user?.name ?? user?.email ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
