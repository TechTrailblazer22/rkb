"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";

/**
 * Turns a signed-in buyer into the owner of a new, empty builder account (status DRAFT).
 * Verification and the company profile come later; this only creates the container.
 */
export async function createBuilderAccount() {
  const user = await requireUser({ returnTo: "/start-listing" });

  // Admins and existing builders already have an area; do not create a second company.
  if (user.role !== "BUYER") redirect(homePathForRole(user.role));

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
    await tx.user.update({ where: { id: user.id }, data: { role: "BUILDER_OWNER" } });
  });

  redirect("/portal");
}
