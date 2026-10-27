"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MODE_COOKIE, homePathForMode } from "@/lib/auth/mode";
import { modeCookieOptions } from "@/lib/auth/mode-cookie";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { acceptInvite } from "@/lib/team/service";

/** Accepts the invitation for the signed-in person; the service checks everything again. */
export async function acceptInvitation(token: string) {
  const user = await requireUser({ returnTo: `/join/${token}` });
  const result = await acceptInvite(getDb(), {
    token,
    user: { id: user.id, email: user.email, storedRole: user.storedRole },
  });
  if (!result.ok) redirect(`/join/${token}?error=${result.code}`);
  (await cookies()).set(MODE_COOKIE, "builder", modeCookieOptions());
  redirect(homePathForMode("builder"));
}
