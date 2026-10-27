"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { revalidateBuilderPages } from "@/lib/projects/revalidate";
import { replyToReview } from "@/lib/reviews/service";

function back(params: Record<string, string>): never {
  redirect(`/portal/reviews?${new URLSearchParams(params).toString()}`);
}

/** The company answers a published review of its own. The owner and managers may; staff may not. */
export async function replyAction(formData: FormData) {
  const ctx = await requireBuilderContext("/portal/reviews");
  if (ctx.memberRole === "STAFF") back({ error: "Only the owner or a manager can reply." });
  const result = await replyToReview(getDb(), {
    builderId: ctx.builder.id,
    reviewId: String(formData.get("reviewId") ?? ""),
    actorId: ctx.user.id,
    text: String(formData.get("reply") ?? ""),
  });
  if (!result.ok) back({ error: result.message });
  await revalidateBuilderPages(getDb(), ctx.builder.id);
  revalidatePath("/portal/reviews");
  back({ saved: "Reply saved." });
}
