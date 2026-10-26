"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { MODE_COOKIE, homePathForMode } from "@/lib/auth/mode";
import { modeCookieOptions } from "@/lib/auth/mode-cookie";

/**
 * Adds a builder account (an empty one, status DRAFT) to the signed-in person's login. Their buyer
 * account is untouched: the same email now has both, and they move between them with the switch at
 * the top of the page. Verification and the company profile come later.
 */
export async function createBuilderAccount() {
  const user = await requireUser({ returnTo: "/start-listing" });

  // Staff have no builder account to create.
  if (user.mode === "admin") redirect(homePathForMode("admin"));

  // They already have one: do not create a second company, just go to it.
  if (!user.canBuild) {
    await getDb().$transaction(async (tx) => {
      const alreadyOwner = await tx.builderMember.findFirst({
        where: { userId: user.id, role: "OWNER" },
        select: { id: true },
      });
      if (alreadyOwner) return;

      const builder = await tx.builder.create({ data: {} });
      await tx.builderMember.create({
        data: { builderId: builder.id, userId: user.id, role: "OWNER" },
      });
      // The stored role records that this email has a builder account as well as the buyer one.
      await tx.user.update({ where: { id: user.id }, data: { role: "BUILDER_OWNER" } });
    });
  }

  // Straight into the builder account they just made (or already had).
  (await cookies()).set(MODE_COOKIE, "builder", modeCookieOptions());
  redirect(homePathForMode("builder"));
}
