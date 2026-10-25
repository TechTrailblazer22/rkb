import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { ProjectStatusBadge } from "@/components/portal/status-badge";
import { ProjectStepper } from "@/components/project/project-stepper";
import { buttonClass } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { STEPS } from "@/lib/projects/fields";
import { requireProjectContext } from "@/lib/projects/context";

export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/portal/projects/[id]">) {
  const { id } = await params;
  const { project, projectChecklist } = await requireProjectContext(id, `/portal/projects/${id}`);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/portal/projects"
          className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All projects
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <ProgressRing percent={projectChecklist.percent} size={56} label="complete" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold">{project.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              <span className="text-xs text-slate-500">{projectChecklist.percent}% complete</span>
            </div>
          </div>
          <Link href={`/portal/projects/${id}/preview`} className={buttonClass("secondary")}>
            <Eye className="size-4" aria-hidden="true" />
            Preview as buyer
          </Link>
        </div>
      </div>

      {/* minmax(0, ...) lets the column shrink below its content, so the stepper scrolls inside itself on a phone instead of stretching the whole page */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <ProjectStepper
          projectId={id}
          steps={STEPS.map((step) => ({
            slug: step.slug,
            label: step.label,
            done: projectChecklist.stepDone[step.slug],
          }))}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
