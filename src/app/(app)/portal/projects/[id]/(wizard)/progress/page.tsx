import { ProgressForm } from "@/components/project/progress-form";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/leads/format";
import { listProgress } from "@/lib/progress/service";
import { requireProjectContext } from "@/lib/projects/context";
import { removeProgressUpdate } from "./actions";

export const metadata = { title: "Progress updates" };

export default async function ProgressPage({
  params,
}: PageProps<"/portal/projects/[id]/progress">) {
  const { id } = await params;
  const ctx = await requireProjectContext(id, `/portal/projects/${id}/progress`);
  const live = ctx.project.status === "LIVE";
  const updates = await listProgress(getDb(), id, 30);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold">Progress updates</h3>
        <p className="mt-1 text-sm text-slate-600">
          Show buyers how the work is going. Updates appear on your project page, newest first, and
          people who saved the project get an email (at most one a day for a project).
        </p>
      </div>

      {!live ? (
        <p
          className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600"
          data-testid="progress-not-live"
        >
          You can post updates once the project is live.
        </p>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <ProgressForm projectId={id} />
        </section>
      )}

      {updates.length > 0 && (
        <ul className="space-y-3" data-testid="progress-list">
          {updates.map((update) => (
            <li
              key={update.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
              data-testid="progress-item"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{formatDate(update.createdAt)}</p>
                <form action={removeProgressUpdate}>
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="updateId" value={update.id} />
                  <button type="submit" className={`${buttonClass("secondary")} text-red-700`}>
                    Delete
                  </button>
                </form>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{update.note}</p>
              {update.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS
                <img
                  src={update.photoUrl}
                  alt=""
                  loading="lazy"
                  className="mt-3 max-h-64 rounded-lg object-cover"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
