import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ProjectStatusBadge } from "@/components/portal/status-badge";
import { ProjectView } from "@/components/project/project-view";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { STEPS } from "@/lib/projects/fields";
import { loadChecklist } from "@/lib/projects/service";
import { loadProjectView } from "@/lib/projects/view";
import { formatBytes } from "@/lib/storage/sniff";
import { decideProject, verifyApproval } from "./actions";

export const metadata = { title: "Review project" };

export default async function AdminProjectPage({
  params,
  searchParams,
}: PageProps<"/admin/projects/[id]">) {
  await requireUser({ returnTo: "/admin/projects", roles: ["ADMIN"] });
  const { id } = await params;
  const { saved, error } = await searchParams;

  const db = getDb();
  const data = await loadProjectView(id);
  if (!data) notFound();

  const [project, checklist, audit] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id },
      include: {
        builder: { select: { id: true, companyName: true, status: true } },
        approvals: true,
      },
    }),
    loadChecklist(db, id),
    db.auditLog.findMany({
      where: { entity: "Project", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  // The same registration number on another project is the classic sign of a copied listing.
  const reraNumbers = project.approvals.flatMap((a) =>
    a.kind === "RERA" && a.number ? [a.number] : [],
  );
  const duplicates = reraNumbers.length
    ? await db.projectApproval.findMany({
        where: { kind: "RERA", number: { in: reraNumbers }, projectId: { not: id } },
        select: { project: { select: { id: true, name: true } } },
      })
    : [];
  const sameName = await db.project.findMany({
    where: {
      builderId: project.builderId,
      id: { not: id },
      name: { equals: project.name, mode: "insensitive" },
      status: { not: "ARCHIVED" },
    },
    select: { id: true, name: true },
  });

  const actorIds = [...new Set(audit.map((e) => e.actorId).filter((v): v is string => !!v))];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, email: true },
  });
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));

  const usable = project.approvals.some(
    (a) =>
      a.verified && a.number && (a.kind === "RERA" || a.kind === "TNCP" || a.kind === "MUNICIPAL"),
  );
  const builderVerified = project.builder.status === "VERIFIED";
  const stepLabel = (slug: string) => STEPS.find((s) => s.slug === slug)?.label ?? slug;
  const ready = Boolean(checklist?.canSubmit) && usable && builderVerified;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="projects" />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/projects" className="text-sm font-semibold text-teal-700 underline">
          Projects
        </Link>
        <span aria-hidden="true">/</span>
        <h2 className="text-xl font-bold">{project.name}</h2>
        <ProjectStatusBadge status={project.status} />
      </div>

      {saved && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-teal-50 p-4 text-sm font-medium text-teal-700"
        >
          <CheckCircle2 className="size-5" aria-hidden="true" /> {String(saved).slice(0, 200)}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700"
        >
          <AlertTriangle className="size-5" aria-hidden="true" /> {String(error).slice(0, 300)}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-bold">Builder</h3>
        <p className="mt-2 text-sm">
          <Link
            href={`/admin/builders/${project.builder.id}`}
            className="font-semibold text-teal-700 underline"
          >
            {project.builder.companyName ?? "(no name)"}
          </Link>{" "}
          is <strong>{project.builder.status.toLowerCase().replace("_", " ")}</strong>.
          {!builderVerified && " A project cannot go live until its builder is verified."}
        </p>
      </section>

      {(duplicates.length > 0 || sameName.length > 0) && (
        <section
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700"
        >
          <p className="font-semibold">Possible duplicate</p>
          <ul className="mt-2 list-disc pl-5">
            {duplicates.map((d) => (
              <li key={d.project.id}>
                The same RERA number is used by{" "}
                <Link href={`/admin/projects/${d.project.id}`} className="font-semibold underline">
                  {d.project.name}
                </Link>
                .
              </li>
            ))}
            {sameName.map((d) => (
              <li key={d.id}>
                This builder already has a project with the same name:{" "}
                <Link href={`/admin/projects/${d.id}`} className="font-semibold underline">
                  {d.name}
                </Link>
                .
              </li>
            ))}
          </ul>
        </section>
      )}

      {checklist && !checklist.canSubmit && (
        <section className="rounded-xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-700">
          <p className="font-semibold">The checklist is not complete ({checklist.percent}%):</p>
          <ul className="mt-1 list-disc pl-5">
            {checklist.missingRequired.map((item) => (
              <li key={item.key}>
                {item.label} ({stepLabel(item.step)})
              </li>
            ))}
            {checklist.problems.map((problem) => (
              <li key={problem.message}>{problem.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="rounded-2xl border border-slate-200 bg-white p-6"
        data-section="admin-approvals"
      >
        <h3 className="text-lg font-bold">Approvals</h3>
        <p className="mt-1 text-sm text-slate-600">
          Open each certificate, compare it with the number the builder entered, then verify it. At
          least one RERA, TNCP or municipal approval must be verified before the project can be
          approved.
        </p>
        {project.approvals.length === 0 ? (
          <p className="mt-4 text-sm font-medium text-red-600">
            The builder has not added any approvals.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {project.approvals.map((approval) => (
              <li
                key={approval.id}
                className="rounded-xl border border-slate-200 p-4"
                data-approval-kind={approval.kind}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {approval.kind.replace("_", " ")}: {approval.number ?? "(no number)"}
                    {approval.validTill && (
                      <span className="ml-2 text-sm font-normal text-slate-500">
                        valid until {approval.validTill.toISOString().slice(0, 10)}
                      </span>
                    )}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${approval.verified ? "bg-teal-50 text-teal-700" : "bg-surface text-slate-700"}`}
                  >
                    {approval.verified ? "Verified" : "Not verified"}
                  </span>
                </div>
                {approval.storageKey ? (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <FileText className="size-4 text-slate-500" aria-hidden="true" />
                    <a
                      href={`/api/project-documents/${approval.id}`}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-teal-700 underline"
                    >
                      {approval.originalName}
                    </a>
                    <span className="text-slate-500">
                      {approval.sizeBytes ? formatBytes(approval.sizeBytes) : ""}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No certificate attached.</p>
                )}
                {approval.reviewNote && (
                  <p className="mt-2 text-sm text-red-700">
                    Note sent to builder: {approval.reviewNote}
                  </p>
                )}
                <form action={verifyApproval} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="approvalId" value={approval.id} />
                  <div className="min-w-48 flex-1">
                    <label htmlFor={`note-${approval.id}`} className="sr-only">
                      Note for {approval.kind} (needed when sending back)
                    </label>
                    <input
                      id={`note-${approval.id}`}
                      name="note"
                      maxLength={1000}
                      placeholder="Note to builder (needed when sending back)"
                      className={inputClass}
                    />
                  </div>
                  <button name="decision" value="verify" className={buttonClass("primary")}>
                    Verify
                  </button>
                  <button name="decision" value="unverify" className={buttonClass("secondary")}>
                    Send back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-6"
        data-section="admin-decision"
      >
        <h3 className="text-lg font-bold">Decision</h3>
        {project.reviewNote && (
          <p className="mt-2 text-sm text-slate-600">
            Last note to the builder:{" "}
            <span className="whitespace-pre-wrap">{project.reviewNote}</span>
          </p>
        )}

        {project.status === "SUBMITTED" && (
          <form action={decideProject} className="mt-4 space-y-4">
            <input type="hidden" name="projectId" value={id} />
            <div>
              <label htmlFor="decision-note" className="block text-sm font-semibold">
                Note to the builder
              </label>
              <p className="text-xs text-slate-500">Required when asking for changes.</p>
              <textarea
                id="decision-note"
                name="note"
                rows={3}
                maxLength={1000}
                className={`${inputClass} mt-1.5`}
              />
            </div>
            {!ready && (
              <p className="text-sm text-amber-700">
                Approve is available once the builder is verified, the checklist is complete, and an
                approval is verified.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                name="action"
                value="APPROVE"
                disabled={!ready}
                className={`${buttonClass("primary")} disabled:cursor-not-allowed`}
              >
                Approve and publish
              </button>
              <button name="action" value="REQUEST_CHANGES" className={buttonClass("accent")}>
                Request changes
              </button>
            </div>
          </form>
        )}
        {project.status === "LIVE" && (
          <form action={decideProject} className="mt-4 space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <label htmlFor="pause-note" className="block text-sm font-semibold">
              Reason for pausing
            </label>
            <textarea
              id="pause-note"
              name="note"
              rows={2}
              maxLength={1000}
              className={inputClass}
            />
            <button name="action" value="PAUSE" className={buttonClass("secondary")}>
              Pause listing
            </button>
          </form>
        )}
        {project.status === "PAUSED" && (
          <form action={decideProject} className="mt-4">
            <input type="hidden" name="projectId" value={id} />
            <button name="action" value="RESUME" className={buttonClass("primary")}>
              Resume listing
            </button>
          </form>
        )}
        {!["SUBMITTED", "LIVE", "PAUSED"].includes(project.status) && (
          <p className="mt-3 text-sm text-slate-600">
            {project.status === "DRAFT"
              ? "The builder has not submitted this project yet."
              : project.status === "CHANGES_REQUESTED"
                ? "Waiting for the builder to make the requested changes."
                : "This project is archived."}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-bold">How buyers will see it</h3>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <ProjectView data={data} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-bold">History</h3>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No activity yet.</p>
        ) : (
          <ol className="mt-4 divide-y divide-slate-100 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
                <span className="w-44 shrink-0 text-slate-500">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span className="font-semibold">{entry.action}</span>
                <span className="text-slate-500">
                  {entry.actorId ? (actorEmail.get(entry.actorId) ?? "unknown user") : "system"}
                </span>
                {entry.meta && typeof entry.meta === "object" && "note" in entry.meta && (
                  <span className="w-full text-slate-700">
                    “{String((entry.meta as { note: unknown }).note)}”
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
