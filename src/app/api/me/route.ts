import { getSessionRole, getSessionUser } from "@/lib/auth/session";

// Tells the static site header whether the visitor is logged in, and as what, so public pages can
// stay cacheable.
export const dynamic = "force-dynamic";

export async function GET() {
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
  } catch (error) {
    // A broken session must never break the header: treat it as logged out.
    console.error("Could not read session for /api/me", error);
  }

  // Only for people who are logged in with a verified email; everyone else costs no database read.
  const role = user?.email_verified === true ? await getSessionRole() : null;

  return Response.json(
    {
      authenticated: Boolean(user),
      emailVerified: user?.email_verified === true,
      name: user?.name ?? user?.email ?? null,
      /** BUYER, BUILDER_OWNER, BUILDER_TEAM or ADMIN. Only changes what the header shows. */
      role,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
