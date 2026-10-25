import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { ProjectStatusBadge } from "@/components/portal/status-badge";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { projectStatusLabel } from "@/lib/projects/status";
import type { ProjectStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Projects" };

const STATUSES = Object.keys(projectStatusLabel) as ProjectStatus[];

export default async function AdminProjectsPage({ searchParams }: PageProps<"/admin/projects">) {
  await requireUser({ returnTo: "/admin/projects", roles: ["ADMIN"] });
  const { status: requested } = await searchParams;
  const status = STATUSES.find((s) => s === requested) ?? "SUBMITTED";

  const projects = await getDb().project.findMany({
    where: { status },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      builder: { select: { companyName: true } },
      _count: { select: { plots: true, approvals: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="projects" />

      <nav aria-label="Filter by status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={`/admin/projects?status=${s}`}
                aria-current={s === status ? "page" : undefined}
                className={`inline-block rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold ${
                  s === status
                    ? "bg-navy-900 text-white"
                    : "hover:bg-surface bg-white text-slate-700"
                }`}
              >
                {projectStatusLabel[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          Nothing here. No projects are {projectStatusLabel[status].toLowerCase()} right now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-left text-sm">
            <caption className="sr-only">Projects with status {projectStatusLabel[status]}</caption>
            <thead className="bg-surface border-b border-slate-200 text-xs text-slate-600 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Project
                </th>
                <th scope="col" className="px-4 py-3">
                  Builder
                </th>
                <th scope="col" className="px-4 py-3">
                  Plots
                </th>
                <th scope="col" className="px-4 py-3">
                  Submitted
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => (
                <tr key={project.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="font-semibold text-teal-700 underline"
                    >
                      {project.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {[project.locality, project.city].filter(Boolean).join(", ")}
                    </p>
                  </td>
                  <td className="px-4 py-3">{project.builder.companyName ?? "—"}</td>
                  <td className="px-4 py-3">{project._count.plots}</td>
                  <td className="px-4 py-3">
                    {project.submittedAt ? formatDateTime(project.submittedAt) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ProjectStatusBadge status={project.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
