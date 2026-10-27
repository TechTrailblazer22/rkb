import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Builder, BuilderDocument } from "@/generated/prisma/client";
import type { BuilderMemberRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { can } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import type { AppUser } from "@/lib/auth/sync-user";
import { buildChecklist, type Checklist } from "@/lib/builders/profile";
import { entitlementsForBuilder, type Entitlements } from "@/lib/entitlements";
import { editMode, type EditMode } from "@/lib/builders/status";

export type BuilderContext = {
  user: AppUser;
  builder: Builder;
  documents: BuilderDocument[];
  checklist: Checklist;
  mode: EditMode;
  /** What the company's plan allows right now. */
  entitlements: Entitlements;
  /** The signed-in person's place in the company. Billing, the team and the profile are the owner's. */
  memberRole: BuilderMemberRole;
};

// One query per request, shared by the layout and the page.
const loadBuilder = cache(async (userId: string) => {
  return getDb().builder.findFirst({
    where: { members: { some: { userId } } },
    include: {
      documents: { orderBy: { createdAt: "asc" } },
      members: { where: { userId }, select: { role: true } },
    },
  });
});

/**
 * For every page and action in the builder portal: the signed-in builder user, their company,
 * its documents, how complete the application is and what they may edit. `ownerOnly` is for the
 * owner's pages and actions. The company is found
 * through the user's membership, never from an id in the URL or the form.
 */
export async function requireBuilderContext(
  returnTo: string,
  options: { ownerOnly?: boolean } = {},
): Promise<BuilderContext> {
  const user = await requireUser({ returnTo, roles: ["BUILDER_OWNER", "BUILDER_TEAM"] });
  const found = await loadBuilder(user.id);

  if (!found || !can(user, "builder:manage", { builderId: found.id })) {
    // A builder role without a company should not happen; fail closed rather than guess.
    throw new Error("No builder account is linked to this user.");
  }

  const { documents, members, ...builder } = found;
  const memberRole = members[0]?.role ?? "STAFF";
  // Billing, the team, the company profile and its documents belong to the owner. A teammate who
  // reaches one of those addresses (or posts to one of its actions) is sent back to the overview.
  if (options.ownerOnly && memberRole !== "OWNER") redirect("/portal");
  return {
    user,
    builder,
    documents,
    checklist: buildChecklist(builder, documents),
    mode: editMode(builder.status),
    entitlements: await entitlementsForBuilder(getDb(), builder.id),
    memberRole,
  };
}
