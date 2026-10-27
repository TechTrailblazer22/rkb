import Link from "next/link";
import { Plus } from "lucide-react";
import { Flash } from "@/components/project/flash";
import { ProjectStatusBadge } from "@/components/portal/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { ProgressRing } from "@/components/ui/progress-ring";
import { getDb } from "@/lib/db";
import { requireBuilderContext } from "@/lib/builders/context";
import { PROJECT_TYPES } from "@/lib/projects/fields";
import { loadChecklist } from "@/lib/projects/service";
import { createProjectAction } from "./actions";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/portal/projects">) {
  const ctx = await requireBuilderContext("/portal/projects");
  const { error } = await searchParams;
  const db = getDb();

  const projects = await db.project.findMany({
    where: { builderId: ctx.builder.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { plots: true, media: true } } },
  });
  const checklists = await Promise.all(projects.map((p) => loadChecklist(db, p.id)));

  const limit = ctx.entitlements.maxProjects;
  const active = projects.filter((p) => p.status !== "ARCHIVED").length;
  const atLimit = limit !== null && active >= limit;
  const blocked = ctx.builder.status === "SUSPENDED" || ctx.builder.status === "REJECTED";
  const verified = ctx.builder.status === "VERIFIED";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Your projects</h2>
        <p className="mt-1 text-sm text-slate-600">
          {limit === null
            ? "Your plan has no limit on projects."
            : `${active} of ${limit} projects used.`}
        </p>
      </div>

      <Flash error={error} />

      {!verified && !blocked && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm text-slate-700">
          You can start drafting projects now. A project can be submitted for review, and go live,
          only once your{" "}
          <Link href="/portal" className="font-semibold text-teal-700 underline">
            company is verified
          </Link>
          .
        </p>
      )}

      {!blocked && (
        <form
          action={createProjectAction}
          className="rounded-2xl border border-slate-200 bg-white p-6"
        >
          <h3 className="font-bold">Add a project</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field id="name" label="Project name" required>
              <input
                id="name"
                name="name"
                required
                minLength={3}
                maxLength={100}
                disabled={atLimit}
                className={inputClass}
                placeholder="For example Green Valley Enclave"
              />
            </Field>
            <Field id="type" label="Type" required>
              <select
                id="type"
                name="type"
                required
                disabled={atLimit}
                defaultValue="PLOTTED"
                className={inputClass}
              >
                {PROJECT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="submit"
              disabled={atLimit}
              className={`${buttonClass("primary")} disabled:cursor-not-allowed`}
            >
              <Plus className="size-4" aria-hidden="true" />
              Create
            </button>
          </div>
          {atLimit && (
            <p className="mt-3 text-sm text-amber-700">
              You have reached your plan&apos;s limit. Archive a project you no longer need to add
              another.
            </p>
          )}
        </form>
      )}

      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No projects yet. Add your first one above.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((project, index) => (
            <li key={project.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-4">
                <ProgressRing
                  percent={checklists[index]?.percent ?? 0}
                  size={64}
                  label="complete"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/portal/projects/${project.id}/basics`}
                    className="block truncate font-bold text-teal-700 underline"
                  >
                    {project.name}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-slate-600">
                    {[project.locality, project.city].filter(Boolean).join(", ") ||
                      "Location not set yet"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ProjectStatusBadge status={project.status} />
                    <span className="text-xs text-slate-500">
                      {project._count.plots} plots, {project._count.media} files
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
