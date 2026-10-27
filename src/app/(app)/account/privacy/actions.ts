"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { deleteBuyerAccount } from "@/lib/privacy/service";

/** Deletes (anonymises) the buyer account after the person has typed DELETE, then logs them out. */
export async function deleteMyAccount(formData: FormData) {
  const user = await requireUser({ returnTo: "/account/privacy", roles: ["BUYER"] });
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    redirect(
      `/account/privacy?error=${encodeURIComponent("Type DELETE in capital letters to confirm.")}`,
    );
  }
  const result = await deleteBuyerAccount(getDb(), user.id);
  if (!result.ok) redirect(`/account/privacy?error=${encodeURIComponent(result.message)}`);
  // The login is gone: end the session too.
  redirect("/logout");
}
