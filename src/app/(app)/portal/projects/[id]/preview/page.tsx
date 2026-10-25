import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { ProjectView } from "@/components/project/project-view";
import { requireProjectContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/view";

export const metadata = { title: "Preview project" };

export default async function PreviewPage({ params }: PageProps<"/portal/projects/[id]/preview">) {
  const { id } = await params;
  await requireProjectContext(id, `/portal/projects/${id}/preview`);
  const data = await loadProjectView(id);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm text-slate-700">
        <Eye className="size-5 shrink-0 text-amber-700" aria-hidden="true" />
        <span>
          <strong>Preview.</strong> This is how buyers will see your project. It is
          {data.project.status === "LIVE" ? " live now." : " not visible to buyers yet."}
        </span>
        <Link
          href={`/portal/projects/${id}/basics`}
          className="font-semibold text-teal-700 underline"
        >
          Back to editing
        </Link>
      </p>
      <ProjectView data={data} />
    </div>
  );
}
