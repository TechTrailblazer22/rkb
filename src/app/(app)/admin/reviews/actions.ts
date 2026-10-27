"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { revalidateBuilderPages } from "@/lib/projects/revalidate";
import { moderateReview } from "@/lib/reviews/service";

function back(params: Record<string, string>): never {
  redirect(`/admin/reviews?${new URLSearchParams(params).toString()}`);
}

/** Staff publish a review, or reject it with a reason the reviewer will see. */
export async function decideReview(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin/reviews", roles: ["ADMIN"] });
  const reviewId = String(formData.get("reviewId") ?? "");
  const decision = formData.get("decision") === "publish" ? "publish" : "reject";
  const result = await moderateReview(getDb(), {
    reviewId,
    adminId: admin.id,
    decision,
    reason: String(formData.get("reason") ?? ""),
  });
  if (!result.ok) back({ error: result.message });
  // The company's public page shows its rating and reviews.
  await revalidateBuilderPages(getDb(), result.review.builderId);
  revalidatePath("/admin/reviews");
  back({ saved: decision === "publish" ? "Review published." : "Review rejected." });
}
