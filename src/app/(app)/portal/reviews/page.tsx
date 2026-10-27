import { Stars } from "@/components/public/stars";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/leads/format";
import { REPLY_MAX, REPLY_MIN, publishedReviews, ratingSummary } from "@/lib/reviews/service";
import { replyAction } from "./actions";

export const metadata = { title: "Reviews" };

export default async function PortalReviewsPage({ searchParams }: PageProps<"/portal/reviews">) {
  const ctx = await requireBuilderContext("/portal/reviews");
  const { saved, error } = await searchParams;
  const db = getDb();
  const [summary, reviews, waiting] = await Promise.all([
    ratingSummary(db, ctx.builder.id),
    publishedReviews(db, ctx.builder.id, 50),
    db.review.count({ where: { builderId: ctx.builder.id, status: "PENDING" } }),
  ]);
  const canReply = ctx.memberRole !== "STAFF";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Reviews</h2>
        <p className="mt-1 text-sm text-slate-600">
          Buyers who have enquired with you can review your company. Our team reads each review
          before it appears. You can reply to a published review once, and edit your reply.
        </p>
      </div>

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

      <section
        className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"
        data-testid="rating-summary"
      >
        {summary.average === null ? (
          <p className="text-sm text-slate-600">No published reviews yet.</p>
        ) : (
          <>
            <p className="text-3xl font-extrabold">{summary.average.toFixed(1)}</p>
            <div>
              <Stars rating={summary.average} size="size-5" />
              <p className="text-sm text-slate-600">
                {summary.count} {summary.count === 1 ? "review" : "reviews"}
              </p>
            </div>
          </>
        )}
        {waiting > 0 && (
          <p className="text-sm text-slate-500">
            {waiting} more {waiting === 1 ? "is" : "are"} waiting for our team to read.
          </p>
        )}
      </section>

      {reviews.length > 0 && (
        <ul className="space-y-4" data-testid="company-reviews">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
              data-testid="company-review"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars rating={review.rating} />
                <p className="text-sm text-slate-600">
                  {review.displayName} · {formatDate(review.createdAt)}
                </p>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{review.body}</p>
              {canReply ? (
                <form action={replyAction} className="mt-4 space-y-2">
                  <input type="hidden" name="reviewId" value={review.id} />
                  <label className="block text-sm font-semibold" htmlFor={`reply-${review.id}`}>
                    {review.reply ? "Your reply" : "Reply"}
                  </label>
                  <textarea
                    id={`reply-${review.id}`}
                    name="reply"
                    rows={3}
                    required
                    minLength={REPLY_MIN}
                    maxLength={REPLY_MAX}
                    defaultValue={review.reply ?? ""}
                    className={inputClass}
                  />
                  <button type="submit" className={buttonClass("secondary")}>
                    {review.reply ? "Update reply" : "Send reply"}
                  </button>
                </form>
              ) : (
                review.reply && (
                  <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <span className="font-semibold">Your reply:</span> {review.reply}
                  </p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
