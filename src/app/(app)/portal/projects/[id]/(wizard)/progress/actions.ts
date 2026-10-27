"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { deleteProgress } from "@/lib/progress/service";
import { requireProjectContext } from "@/lib/projects/context";
import { revalidateProjectPages } from "@/lib/projects/revalidate";
import { getStorage } from "@/lib/storage";

/** Deletes one of the company's own updates, and its photo. */
export async function removeProgressUpdate(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const updateId = String(formData.get("updateId") ?? "");
  const ctx = await requireProjectContext(projectId, `/portal/projects/${projectId}/progress`);
  const result = await deleteProgress(getDb(), {
    updateId,
    builderId: ctx.builder.id,
    actorId: ctx.user.id,
  });
  if (result.photoKey) {
    try {
      await getStorage().remove(result.photoKey, "public");
    } catch (error) {
      console.error("Could not remove a progress photo", error);
    }
  }
  await revalidateProjectPages(getDb(), projectId);
  revalidatePath(`/portal/projects/${projectId}/progress`);
  redirect(`/portal/projects/${projectId}/progress`);
}
