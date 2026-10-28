import Link from "next/link";
import { ExternalLink, Eye, Pencil, Plus, Search } from "lucide-react";
import { Flash } from "@/components/project/flash";
import { ProjectStatusBadge } from "@/components/portal/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { ProgressRing } from "@/components/ui/progress-ring";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { requireBuilderContext } from "@/lib/builders/context";
import { PROJECT_TYPES } from "@/lib/projects/fields";
import { loadChecklist } from "@/lib/projects/service";
import { createProjectAction } from "./actions";

export const metadata = { title: "My projects" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The groups a builder thinks in, and the statuses behind each.
const GROUPS = [
  { key: "live", label: "Live", statuses: ["LIVE"] },
  { key: "review", label: "In review", statuses: ["SUBMITTED"] },
  { key: "changes", label: "Needs changes", statuses: ["CHANGES_REQUESTED"] },
  { key: "draft", label: "Drafts", statuses: ["DRAFT"] },
  { key: "paused", label: "Offline", statuses: ["PAUSED"] },
  { key: "archived", label: "Archived", statuses: ["ARCHIVED"] },
] as const satisfies readonly { key: string; label: string; statuses: ProjectStatus[] }[];

/** What the builder should do next, in one sentence, for each status. */
function nextStep(project: {
  status: ProjectStatus;
  reviewNote: string | null;
  pauseReason: string | null;
}): string {
  switch (project.status) {
    case "DRAFT":
      return "Fill in the details, then publish it. Publishing is free; our team checks it before it goes live.";
    case "SUBMITTED":
      return "Our team is checking it. You will get an email when there is a decision.";
    case "CHANGES_REQUESTED":
      return project.reviewNote
        ? `Our team asked for changes: ${project.reviewNote.slice(0, 160)}`
        : "Our team asked for changes. Open it to see what to fix, then publish it again.";
    case "LIVE":
      return "Buyers can see this project now.";
    case "PAUSED":
      return project.reviewNote
        ? `Taken offline: ${project.reviewNote.slice(0, 160)}`
        : "This project is offline. Open it to see why.";
    case "ARCHIVED":
      return "Archived: hidden from buyers and not counted towards your project limit.";
  }
}

export default async function ProjectsPage({ searchParams }: PageProps<"/portal/projects">) {
  const ctx = await requireBuilderContext("/portal/projects");
  const raw = await searchParams;
  const error = raw.error;
  const group = GROUPS.find((g) => g.key === first(raw.status)) ?? null;
  const q = (first(raw.q) ?? "").trim().slice(0, 80);
  const db = getDb();

  // One query for everything the builder owns; the filters and the counts are worked out from it, so
  // the numbers on the tabs always agree with the list.
  const all = await db.project.findMany({
    where: { builderId: ctx.builder.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { plots: true, media: true } } },
  });
  const counts = Object.fromEntries(
    GROUPS.map((g) => [
      g.key,
      all.filter((p) => (g.statuses as readonly string[]).includes(p.status)).length,
    ]),
  ) as Record<(typeof GROUPS)[number]["key"], number>;
  const needle = q.toLowerCase();
  const shown = all.filter((p) => {
    const inGroup = group
      ? (group.statuses as readonly string[]).includes(p.status)
      : p.status !== "ARCHIVED";
    const matches =
      !needle || [p.name, p.city, p.locality].some((v) => v?.toLowerCase().includes(needle));
    return inGroup && matches;
  });
  const checklists = new Map(
    await Promise.all(shown.map(async (p) => [p.id, await loadChecklist(db, p.id)] as const)),
  );

  const limit = ctx.entitlements.maxProjects;
  const active = all.filter((p) => p.status !== "ARCHIVED").length;
  const atLimit = limit !== null && active >= limit;
  const blocked = ctx.builder.status === "SUSPENDED" || ctx.builder.status === "REJECTED";
  const verified = ctx.builder.status === "VERIFIED";
  const link = (key: string | null) => {
    const params = new URLSearchParams();
    if (key) params.set("status", key);
    if (q) params.set("q", q);
    const query = params.toString();
    return `/portal/projects${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">My projects</h2>
        <p className="mt-1 text-sm text-slate-600" data-testid="project-allowance">
          {limit === null ? "No limit on projects." : `${active} of ${limit} projects used.`}{" "}
          Publishing a project is free: you never need to buy a plan to put a project in front of
          buyers.
        </p>
      </div>

      <Flash error={error} />

      {!verified && !blocked && (
        <p
          className="rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm text-slate-700"
          data-testid="verify-first"
        >
          You can start drafting projects now. A project can be published once your{" "}
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
              You have reached your plan&apos;s limit of projects. Archive a project you no longer
              need to add another, or{" "}
              <Link href="/portal/billing" className="font-semibold underline">
                see plans
              </Link>
              .
            </p>
          )}
        </form>
      )}

      {all.length > 0 && (
        <div className="space-y-3">
          <nav
            aria-label="Filter projects by status"
            className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
          >
            <ul className="flex gap-2 whitespace-nowrap">
              <li>
                <Link
                  href={link(null)}
                  aria-current={!group ? "true" : undefined}
                  data-testid="filter-all"
                  className={`inline-block rounded-full border px-4 py-2 text-sm font-semibold ${!group ? "border-navy-900 bg-navy-900 text-white" : "hover:bg-surface border-slate-300 bg-white"}`}
                >
                  All ({active})
                </Link>
              </li>
              {GROUPS.filter((g) => counts[g.key] > 0 || group?.key === g.key).map((g) => (
                <li key={g.key}>
                  <Link
                    href={link(g.key)}
                    aria-current={group?.key === g.key ? "true" : undefined}
                    data-testid={`filter-${g.key}`}
                    className={`inline-block rounded-full border px-4 py-2 text-sm font-semibold ${group?.key === g.key ? "border-navy-900 bg-navy-900 text-white" : "hover:bg-surface border-slate-300 bg-white"}`}
                  >
                    {g.label} ({counts[g.key]})
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {all.length > 3 && (
            <form action="/portal/projects" method="get" className="flex flex-wrap gap-2">
              {group && <input type="hidden" name="status" value={group.key} />}
              <label className="relative block min-w-0 flex-1 basis-56">
                <span className="sr-only">Search your projects</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  maxLength={80}
                  placeholder="Search by name or place"
                  className={`${inputClass} pl-9`}
                />
              </label>
              <button type="submit" className={buttonClass("secondary")}>
                Search
              </button>
            </form>
          )}
        </div>
      )}

      {all.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"
          data-testid="no-projects"
        >
          <h3 className="font-bold">You have no projects yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Add your first project above. You can save it as you go, publish it when it is ready,
            and buyers will find it in search. It costs nothing to publish.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600"
          data-testid="no-matches"
        >
          No projects match.{" "}
          <Link href="/portal/projects" className="font-semibold text-teal-700 underline">
            Show all projects
          </Link>
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="project-list">
          {shown.map((project) => {
            const checklist = checklists.get(project.id);
            const editable = project.status !== "ARCHIVED";
            return (
              <li
                key={project.id}
                data-testid="project-card"
                data-status={project.status}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start gap-4">
                  <ProgressRing percent={checklist?.percent ?? 0} size={64} label="complete" />
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
                <p className="mt-3 flex-1 text-sm text-slate-700" data-testid="next-step">
                  {nextStep(project)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {editable && (
                    <Link
                      href={`/portal/projects/${project.id}/${project.status === "DRAFT" || project.status === "CHANGES_REQUESTED" ? "review" : "basics"}`}
                      className={buttonClass(
                        project.status === "DRAFT" || project.status === "CHANGES_REQUESTED"
                          ? "primary"
                          : "secondary",
                      )}
                      data-testid="primary-action"
                    >
                      {project.status === "DRAFT"
                        ? "Review and publish"
                        : project.status === "CHANGES_REQUESTED"
                          ? "Fix and publish again"
                          : "Open"}
                    </Link>
                  )}
                  {editable && (
                    <Link
                      href={`/portal/projects/${project.id}/basics`}
                      className={buttonClass("secondary")}
                    >
                      <Pencil className="size-4" aria-hidden="true" /> Edit
                    </Link>
                  )}
                  {editable && (
                    <Link
                      href={`/portal/projects/${project.id}/preview`}
                      className={buttonClass("secondary")}
                    >
                      <Eye className="size-4" aria-hidden="true" /> Preview
                    </Link>
                  )}
                  {project.status === "LIVE" && project.slug && (
                    <Link
                      href={`/project/${project.slug}`}
                      target="_blank"
                      className={buttonClass("secondary")}
                      data-testid="view-public"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" /> View as a buyer
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
