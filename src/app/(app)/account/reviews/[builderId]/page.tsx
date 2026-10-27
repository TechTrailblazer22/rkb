import Link from "next/link";
import { notFound } from "next/navigation";
import { Stars } from "@/components/public/stars";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { REVIEW_MAX, REVIEW_MIN, reviewEligibility } from "@/lib/reviews/service";
import { saveReview } from "./actions";

export const metadata = { title: "Review a builder", robots: { index: false } };

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/account/reviews/[builderId]">) {
  const { builderId } = await params;
  const { saved, error } = await searchParams;
  const user = await requireUser({ returnTo: `/account/reviews/${builderId}`, roles: ["BUYER"] });
  const db = getDb();
  const [eligibility, builder] = await Promise.all([
    reviewEligibility(db, { buyerId: user.id, builderId }),
    db.builder.findFirst({ where: { id: builderId }, select: { companyName: true, slug: true } }),
  ]);
  if (!builder) notFound();
  const review = eligibility.ok ? eligibility.existing : null;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <Link href="/account/enquiries" className="text-sm font-semibold text-teal-700 underline">
          My enquiries
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Review {builder.companyName ?? "this company"}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tell other buyers what it was like to deal with this company. Reviews are read by our team
          before they appear, and they show only your first name and the first letter of your last.
        </p>
      </div>

      {saved === "1" && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
          data-testid="review-saved"
        >
          Thank you. Your review is with our team and will appear once it has been read.
        </p>
      )}
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {!eligibility.ok ? (
        <p
          className="rounded-xl border border-slate-200 bg-white p-5 text-sm"
          data-testid="review-not-allowed"
        >
          {eligibility.message}
        </p>
      ) : (
        <>
          {review && (
            <section
              className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
              data-testid="review-status"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={review.rating} />
                <Badge tone={review.status === "PUBLISHED" ? "teal" : "amber"}>
                  {review.status === "PUBLISHED"
                    ? "Published"
                    : review.status === "PENDING"
                      ? "Waiting to be read"
                      : "Not published"}
                </Badge>
              </div>
              {review.status === "REJECTED" && review.rejectReason && (
                <p className="mt-2 text-red-700">
                  Our team could not publish it: {review.rejectReason} You can edit it and send it
                  again.
                </p>
              )}
              {review.status === "PUBLISHED" && (
                <p className="mt-2 text-slate-600">
                  Editing a published review takes it down until our team has read the new version.
                </p>
              )}
            </section>
          )}

          <form
            action={saveReview}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
          >
            <input type="hidden" name="builderId" value={builderId} />
            <fieldset>
              <legend className="text-sm font-semibold">Your rating</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="rating"
                      value={n}
                      required
                      defaultChecked={review?.rating === n}
                      className="size-4 accent-teal-700"
                    />
                    {n} {n === 1 ? "star" : "stars"}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              id="review-body"
              label="Your review"
              hint={`${REVIEW_MIN} to ${REVIEW_MAX} characters. Please stick to your own experience.`}
            >
              <textarea
                id="review-body"
                name="body"
                rows={6}
                required
                minLength={REVIEW_MIN}
                maxLength={REVIEW_MAX}
                defaultValue={review?.body ?? ""}
                className={inputClass}
              />
            </Field>
            <button type="submit" className={buttonClass("primary")}>
              {review ? "Update my review" : "Send my review"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
