import { Sparkles } from "lucide-react";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import {
  BOOKING_WINDOW_DAYS,
  dayString,
  featuredInMonth,
  istToday,
  parseDay,
  upcomingFeatured,
} from "@/lib/featured/service";
import { formatDate } from "@/lib/leads/format";
import { redirect } from "next/navigation";
import { featureProject, unfeatureProject } from "./actions";

export const metadata = { title: "Promote" };

export default async function PromotePage({ searchParams }: PageProps<"/portal/promote">) {
  const ctx = await requireBuilderContext("/portal/promote");
  if (ctx.memberRole === "STAFF") redirect("/portal");
  const { saved, error } = await searchParams;
  const db = getDb();
  const e = ctx.entitlements;
  const today = istToday();
  const todayDate = parseDay(today)!;
  const max = dayString(new Date(todayDate.getTime() + BOOKING_WINDOW_DAYS * 86_400_000));

  const [live, upcoming, usedThisMonth] = await Promise.all([
    db.project.findMany({
      where: { builderId: ctx.builder.id, status: "LIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    upcomingFeatured(db, ctx.builder.id),
    featuredInMonth(db, ctx.builder.id, todayDate),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Promote a project</h2>
        <p className="mt-1 text-sm text-slate-600">
          A featured project is listed first in search for the whole day and carries a Featured
          label. Choose the days that suit your launches and open houses.
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

      {e.priorityListing && (
        <p className="rounded-xl border border-teal-700/20 bg-teal-50 p-4 text-sm text-teal-900">
          Your plan lists all your projects first in search, every day, and shows them in the
          homepage spotlight. There is nothing to book.
        </p>
      )}

      {e.featuredDaysPerMonth === 0 ? (
        !e.priorityListing && (
          <UpgradeNotice feature="Featured days" plan="GROWTH" lapsed={!e.active} />
        )
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="size-5 text-amber-600" aria-hidden="true" /> Book a featured day
            </h3>
            <p className="text-sm text-slate-600" data-testid="featured-allowance">
              {usedThisMonth} of {e.featuredDaysPerMonth} used this month
            </p>
          </div>
          {live.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              You have no live project yet. A project can be featured once it is live.
            </p>
          ) : (
            <form action={featureProject} className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 basis-56">
                <Field id="feature-project" label="Project">
                  <select id="feature-project" name="projectId" className={inputClass} required>
                    {live.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div>
                <Field id="feature-day" label="Day" hint="Indian time">
                  <input
                    id="feature-day"
                    name="day"
                    type="date"
                    required
                    min={today}
                    max={max}
                    defaultValue={today}
                    className={inputClass}
                  />
                </Field>
              </div>
              <button type="submit" className={buttonClass("primary")}>
                Book the day
              </button>
            </form>
          )}
          <p className="mt-3 text-xs text-slate-500">
            The allowance is counted by the month of the featured day. You can book up to{" "}
            {BOOKING_WINDOW_DAYS} days ahead and take back a day before it starts.
          </p>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h3 className="text-base font-bold">Booked days</h3>
          <ul className="mt-3 divide-y divide-slate-100" data-testid="featured-days">
            {upcoming.map((entry) => {
              const iso = dayString(entry.day);
              return (
                <li
                  key={`${entry.projectId}-${iso}`}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{entry.projectName}</p>
                    <p className="text-sm text-slate-600">
                      {formatDate(entry.day)}
                      {iso === today ? " (today)" : ""}
                    </p>
                  </div>
                  {iso > today && (
                    <form action={unfeatureProject}>
                      <input type="hidden" name="projectId" value={entry.projectId} />
                      <input type="hidden" name="day" value={iso} />
                      <button type="submit" className={buttonClass("secondary")}>
                        Take back
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
