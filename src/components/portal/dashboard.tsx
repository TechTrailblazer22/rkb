import Link from "next/link";
import { BadgeCheck, FolderOpen, PlusCircle } from "lucide-react";
import { AvailabilityBar } from "@/components/ui/availability-bar";
import { buttonClass } from "@/components/ui/button";
import type { BuilderDashboard } from "@/lib/builders/dashboard";
import { projectStatusLabel } from "@/lib/projects/status";

function Tile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
}) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-sm text-slate-600">
        {href ? (
          <Link
            href={href}
            className="after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1 text-3xl font-extrabold tracking-tight">{value}</dd>
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

/** The overview of a verified builder: how many projects are where, and the live plot numbers. */
export function BuilderDashboardView({ data }: { data: BuilderDashboard }) {
  const { projects, plots, attention, leads } = data;

  return (
    <div className="space-y-6" data-testid="builder-dashboard">
      <p className="flex items-center gap-2 text-sm font-semibold text-teal-800">
        <BadgeCheck className="size-5" aria-hidden="true" />
        <span>
          <strong>You are a Verified Builder.</strong> Your live projects show the Verified builder
          badge to buyers.
        </span>
      </p>

      {projects.total === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <FolderOpen className="mx-auto size-10 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">Add your first project</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Describe the project, add its plots, photos and approvals, and submit it for review.
            Buyers can see it as soon as it is approved.
          </p>
          <Link href="/portal/projects" className={`${buttonClass("primary")} mt-5`}>
            Create a project
          </Link>
        </section>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Live projects" value={projects.live} hint="Visible to buyers" />
            <Tile label="Plots available" value={plots.available} hint="Across live projects" />
            <Tile
              label="New enquiries"
              value={leads.new}
              hint="Not contacted yet"
              href="/portal/leads?status=NEW"
            />
            <Tile
              label="Follow-ups due"
              value={leads.followUpsDue}
              hint="Dates that have arrived"
              href="/portal/leads?due=1"
            />
          </dl>
          <p className="text-sm text-slate-600">
            {projects.inReview} in review · {projects.draft}{" "}
            {projects.draft === 1 ? "draft" : "drafts"} ·{" "}
            {projects.changesRequested + projects.paused} need your attention
          </p>

          <section
            aria-labelledby="live-availability"
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <h2 id="live-availability" className="text-lg font-bold">
              Availability across your live projects
            </h2>
            {plots.total > 0 ? (
              <>
                <p className="mt-1 text-sm text-slate-600">
                  {plots.available} of {plots.total} plots are still available.
                </p>
                <AvailabilityBar
                  available={plots.available}
                  booked={plots.booked}
                  sold={plots.sold}
                  size="md"
                  legend
                  className="mt-3"
                />
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                {projects.live === 0
                  ? "None of your projects is live yet, so buyers cannot see any plots."
                  : "Your live projects have no plots listed yet."}
              </p>
            )}
          </section>

          <section
            aria-labelledby="needs-attention"
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <h2 id="needs-attention" className="text-lg font-bold">
              Needs your attention
            </h2>
            {attention.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">Nothing is waiting on you.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {attention.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-sm text-slate-600">
                        {projectStatusLabel[item.status]}
                        {item.note ? `: ${item.note}` : ""}
                      </p>
                    </div>
                    <Link
                      href={`/portal/projects/${item.id}/review`}
                      className={buttonClass("secondary")}
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap gap-3">
            <Link href="/portal/projects" className={buttonClass("primary")}>
              <FolderOpen className="size-4" aria-hidden="true" /> All projects
            </Link>
            <Link href="/portal/projects" className={buttonClass("secondary")}>
              <PlusCircle className="size-4" aria-hidden="true" /> Add a project
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
