import "server-only";
import { cache } from "react";
import type { Builder, BuilderDocument } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { can } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import type { AppUser } from "@/lib/auth/sync-user";
import { buildChecklist, type Checklist } from "@/lib/builders/profile";
import { editMode, type EditMode } from "@/lib/builders/status";

export type BuilderContext = {
  user: AppUser;
  builder: Builder;
  documents: BuilderDocument[];
  checklist: Checklist;
  mode: EditMode;
};

// One query per request, shared by the layout and the page.
const loadBuilder = cache(async (userId: string) => {
  return getDb().builder.findFirst({
    where: { members: { some: { userId } } },
    include: { documents: { orderBy: { createdAt: "asc" } } },
  });
});

/**
 * For every page and action in the builder portal: the signed-in builder user, their company,
 * its documents, how complete the application is and what they may edit. The company is found
 * through the user's membership, never from an id in the URL or the form.
 */
export async function requireBuilderContext(returnTo: string): Promise<BuilderContext> {
  const user = await requireUser({ returnTo, roles: ["BUILDER_OWNER", "BUILDER_TEAM"] });
  const found = await loadBuilder(user.id);

  if (!found || !can(user, "builder:manage", { builderId: found.id })) {
    // A builder role without a company should not happen; fail closed rather than guess.
    throw new Error("No builder account is linked to this user.");
  }

  const { documents, ...builder } = found;
  return {
    user,
    builder,
    documents,
    checklist: buildChecklist(builder, documents),
    mode: editMode(builder.status),
  };
}
