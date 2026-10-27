import { AdminNav } from "@/components/admin/admin-nav";
import { Stars } from "@/components/public/stars";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/leads/format";
import { REJECT_REASON_MIN, pendingReviews } from "@/lib/reviews/service";
import { decideReview } from "./actions";

export const metadata = { title: "Reviews" };

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireUser({ returnTo: "/admin/reviews", roles: ["ADMIN"] });
  const { saved, error } = await searchParams;
  const reviews = await pendingReviews(getDb());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="reviews" />

      {typeof saved === "string" && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
        >
          {saved}
        </p>
      )}
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <p className="text-sm text-slate-600">
        Read each review before it appears. Publish honest reviews, including unflattering ones.
        Reject one that is abusive, names a person, shares contact details, is not about this
        company, or is clearly fake, and say why: the reviewer will see the reason.
      </p>

      {reviews.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600"
          data-testid="no-reviews"
        >
          Nothing is waiting.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="pending-reviews">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
              data-testid="pending-review"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{review.builder.companyName ?? "(no name)"}</p>
                <p className="text-sm text-slate-600">
                  {review.displayName} · {formatDate(review.createdAt)}
                </p>
              </div>
              <div className="mt-1">
                <Stars rating={review.rating} />
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{review.body}</p>
              <form action={decideReview} className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="reviewId" value={review.id} />
                <label className="min-w-0 flex-1 basis-60">
                  <span className="sr-only">Reason, if you reject it</span>
                  <input
                    name="reason"
                    maxLength={300}
                    placeholder={`Reason, if you reject it (at least ${REJECT_REASON_MIN} characters)`}
                    className={inputClass}
                  />
                </label>
                <button
                  type="submit"
                  name="decision"
                  value="publish"
                  className={buttonClass("primary")}
                >
                  Publish
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className={buttonClass("secondary")}
                >
                  Reject
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
