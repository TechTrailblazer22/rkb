"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";
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

  redirect(safeReturnTo(parsed.data.returnTo, homePathForRole(user.role)));
}
