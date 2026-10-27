"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { createLimiter } from "@/lib/rate-limit";
import { revalidateBuilderPages } from "@/lib/projects/revalidate";
import { submitReview } from "@/lib/reviews/service";

const limiter = createLimiter({ max: 15, windowMs: 3_600_000 });

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** Saves the buyer's review (new, or an edit of their earlier one). It waits for staff to publish it. */
export async function saveReview(formData: FormData) {
  const builderId = text(formData, "builderId");
  const user = await requireUser({ returnTo: `/account/reviews/${builderId}`, roles: ["BUYER"] });
  const base0 = `/account/reviews/${encodeURIComponent(builderId)}`;
  if (limiter.hit(user.id)) {
    redirect(`${base0}?error=${encodeURIComponent("Please wait a little before sending again.")}`);
  }
  const result = await submitReview(getDb(), {
    buyerId: user.id,
    buyerName: user.name,
    builderId,
    rating: text(formData, "rating"),
    body: text(formData, "body"),
  });
  const base = `/account/reviews/${encodeURIComponent(builderId)}`;
  if (!result.ok) redirect(`${base}?error=${encodeURIComponent(result.message)}`);
  // Editing a published review takes it down until staff have read it again, so the company's
  // public page (which shows its reviews) must be rebuilt now, not at its next scheduled refresh.
  await revalidateBuilderPages(getDb(), builderId);
  redirect(`${base}?saved=1`);
}
