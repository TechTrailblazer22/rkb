"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { saveLayoutMap } from "@/lib/layout-map/service";
import { requireProjectContext } from "@/lib/projects/context";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

export type MapSaveResult = { ok: boolean; message: string };

/** Saves the whole layout map. The project is found through the signed-in builder, never by id alone. */
export async function saveLayoutMapAction(
  projectId: string,
  shapes: unknown,
): Promise<MapSaveResult> {
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/layout-map`);
  if (!ctx.entitlements.layoutMap) {
    return {
      ok: false,
      message: "The interactive layout map is part of the Growth plan and above.",
    };
  }
  // Submitted projects are locked while staff review them; every other state may be edited.
  if (ctx.projectMode === "locked") {
    return { ok: false, message: "The project cannot be changed right now." };
  }
  const result = await saveLayoutMap(getDb(), {
    projectId,
    builderId: ctx.builder.id,
    shapes,
    actorId: ctx.user.id,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (ctx.project.status === "LIVE") await revalidateProjectPages(getDb(), projectId);
  revalidatePath(`/portal/projects/${projectId}/layout-map`);
  return {
    ok: true,
    message: `Saved. ${result.count} ${result.count === 1 ? "plot" : "plots"} on the map.`,
  };
}
