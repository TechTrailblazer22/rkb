"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { MODE_COOKIE, homePathForMode } from "@/lib/auth/mode";
import { modeCookieOptions } from "@/lib/auth/mode-cookie";
import { landingAfterConsent } from "@/lib/auth/landing";
import { safeReturnTo } from "@/lib/auth/paths";
import { TERMS_VERSION } from "@/lib/legal";

const schema = z.object({
  accept: z.literal("on"),
  returnTo: z.string().optional(),
});

export async function acceptTerms(formData: FormData) {
  const user = await requireUser({ returnTo: "/welcome", consent: false });
  const returnTo = formData.get("returnTo");

  const parsed = schema.safeParse({
    accept: formData.get("accept"),
    returnTo: typeof returnTo === "string" ? returnTo : undefined,
  });
  if (!parsed.success) {
    const back = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined, "");
    redirect(`/welcome?error=accept${back ? `&returnTo=${encodeURIComponent(back)}` : ""}`);
  }

  await getDb().user.update({
    where: { id: user.id },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() },
  });

  // If they were on their way through /dashboard or /switch (a login, or the switch button), apply
  // that here and remember the account: a server action cannot hand a cookie back through a
  // redirect to a route.
  const { path, mode } = landingAfterConsent(
    user,
    safeReturnTo(parsed.data.returnTo, homePathForMode(user.mode)),
  );
  if (mode) (await cookies()).set(MODE_COOKIE, mode, modeCookieOptions());
  redirect(path);
}
