import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { ConfirmSubmit } from "@/components/project/confirm-submit";
import { SubmitProjectPanel } from "@/components/project/submit-project-panel";
import { buttonClass } from "@/components/ui/button";
import { STEPS } from "@/lib/projects/fields";
import type { ProjectContext } from "@/lib/projects/context";
import { archiveProject, reopenProject } from "@/app/(app)/portal/projects/actions";

const stepLabel = (slug: string) => STEPS.find((s) => s.slug === slug)?.label ?? slug;

export function ReviewStep({ ctx }: { ctx: ProjectContext }) {
  const { project, builder, projectChecklist: checklist } = ctx;
  const id = project.id;
  const verified = builder.status === "VERIFIED";
  const editable = project.status === "DRAFT" || project.status === "CHANGES_REQUESTED";
  const required = checklist.items.filter((i) => i.required);
  const recommended = checklist.items.filter((i) => !i.required);

  return (
    <div className="space-y-6">
      {project.status === "SUBMITTED" && (
        <section className="flex gap-4 rounded-2xl border border-amber-500/40 bg-amber-50 p-6">
          <Clock className="size-7 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-bold">Under review</h3>
            <p className="mt-1 text-sm text-slate-700">
              Our team is checking the project and its approvals. You will get an email with the
              result. It is locked for editing until then.
            </p>
          </div>
        </section>
      )}
      {project.status === "LIVE" && (
        <section className="rounded-2xl border border-teal-500/40 bg-teal-50 p-6">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <CheckCircle2 className="size-6 text-teal-700" aria-hidden="true" /> This project is
            live
          </h3>
          <p className="mt-1 text-sm text-slate-700">
            You can update photos, plots, prices and descriptions at any time. To change the project
            name, location or legal details, take it offline for editing; it goes live again once
            re-approved.
          </p>
          <form action={reopenProject} className="mt-4">
            <input type="hidden" name="projectId" value={id} />
            <ConfirmSubmit
              message="Take this project offline so you can edit its name, location and legal details? It will need to be approved again."
              className={buttonClass("secondary")}
            >
              Edit and resubmit
            </ConfirmSubmit>
          </form>
        </section>
      )}
      {project.status === "CHANGES_REQUESTED" && project.reviewNote && (
        <section className="rounded-2xl border border-amber-500/50 bg-amber-50 p-6">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="size-6 text-amber-700" aria-hidden="true" /> A few changes are
            needed
          </h3>
          <blockquote className="mt-3 border-l-4 border-amber-500 bg-white/70 px-4 py-3 text-sm whitespace-pre-wrap">
            {project.reviewNote}
          </blockquote>
        </section>
      )}
      {project.status === "PAUSED" && (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-6">
          <h3 className="text-lg font-bold">This project is paused</h3>
          {project.reviewNote && (
            <blockquote className="mt-3 border-l-4 border-red-400 bg-white/70 px-4 py-3 text-sm whitespace-pre-wrap">
              {project.reviewNote}
            </blockquote>
          )}
          <p className="mt-3 text-sm text-slate-700">
            It is not shown to buyers. Contact support to have it resumed.
          </p>
        </section>
      )}
      {project.status === "ARCHIVED" && (
        <p className="bg-surface rounded-2xl p-6 text-sm text-slate-700">
          This project is archived and no longer counts towards your plan.
        </p>
      )}

      {(editable || project.status === "DRAFT") && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-bold">Before you submit</h3>
          <p className="mt-1 text-sm text-slate-600">
            {checklist.percent}% complete. Nothing here is mandatory: you can submit at any time,
            and our team will review what you have filled in. A fuller listing gets more enquiries.
          </p>

          {checklist.problems.length > 0 && (
            <ul className="mt-4 space-y-2">
              {checklist.problems.map((problem) => (
                <li
                  key={problem.message}
                  className="flex items-start gap-2 text-sm font-medium text-red-700"
                >
                  <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span>
                    {problem.message}{" "}
                    <Link href={`/portal/projects/${id}/${problem.step}`} className="underline">
                      Fix in {stepLabel(problem.step)}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {required.length > 0 && (
            <>
              <h4 className="mt-5 text-sm font-bold">Required</h4>
              <ul className="mt-2 space-y-2" data-testid="required-items">
                {required.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-start gap-2 text-sm"
                    data-item={item.key}
                    data-done={item.done}
                  >
                    {item.done ? (
                      <CheckCircle2
                        className="mt-0.5 size-5 shrink-0 text-teal-500"
                        aria-label="Done"
                      />
                    ) : (
                      <XCircle
                        className="mt-0.5 size-5 shrink-0 text-red-500"
                        aria-label="Missing"
                      />
                    )}
                    <span>
                      {item.done ? (
                        item.label
                      ) : (
                        <Link
                          href={`/portal/projects/${id}/${item.step}`}
                          className="font-semibold text-teal-700 underline"
                        >
                          {item.label}
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="mt-5" open={required.length === 0} data-testid="optional-items">
            <summary className="cursor-pointer text-sm font-bold">
              {required.length > 0 ? "Recommended" : "Details"} (
              {recommended.filter((i) => i.done).length} of {recommended.length} filled in)
            </summary>
            <ul className="mt-2 space-y-2">
              {recommended.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-sm">
                  {item.done ? (
                    <CheckCircle2
                      className="mt-0.5 size-5 shrink-0 text-teal-500"
                      aria-label="Done"
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 size-5 shrink-0 text-slate-300"
                      aria-label="Not done"
                    />
                  )}
                  <span>
                    {item.done ? (
                      item.label
                    ) : (
                      <Link
                        href={`/portal/projects/${id}/${item.step}`}
                        className="text-teal-700 underline"
                      >
                        {item.label}
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {editable && (
        <SubmitProjectPanel
          projectId={id}
          canSubmit={checklist.canSubmit && verified}
          blockedReason={
            !verified
              ? "Your company must be verified before a project can be submitted. Finish your company application first."
              : undefined
          }
        />
      )}
      {project.status !== "ARCHIVED" && project.status !== "SUBMITTED" && (
        <form action={archiveProject} className="border-t border-slate-200 pt-6">
          <input type="hidden" name="projectId" value={id} />
          <ConfirmSubmit
            message="Archive this project? It will be hidden and stop counting towards your plan. This cannot be undone."
            className="text-sm font-semibold text-red-600 underline"
          >
            Archive this project
          </ConfirmSubmit>
        </form>
      )}
    </div>
  );
}
