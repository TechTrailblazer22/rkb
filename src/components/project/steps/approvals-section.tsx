import { BadgeCheck, FileText } from "lucide-react";
import { ConfirmSubmit } from "@/components/project/confirm-submit";
import { ProjectUpload } from "@/components/project/project-upload";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import type { ApprovalKind } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { formatBytes } from "@/lib/storage/sniff";
import type { ProjectEditMode } from "@/lib/projects/status";
import { deleteApproval, saveApproval } from "@/app/(app)/portal/projects/actions";

const KINDS: { kind: ApprovalKind; label: string; help: string }[] = [
  {
    kind: "RERA",
    label: "RERA registration",
    help: "The registration number from your state RERA certificate.",
  },
  {
    kind: "TNCP",
    label: "TNCP / DTCP layout approval",
    help: "The layout approval number from the town planning authority.",
  },
  {
    kind: "MUNICIPAL",
    label: "Municipal or panchayat approval",
    help: "Building or layout approval from the local body.",
  },
  {
    kind: "BANK_LOAN",
    label: "Bank loan approval",
    help: "If a bank has approved the project for home loans.",
  },
];

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");

/** One card per approval: its number and dates, the certificate file, and whether we have verified it. */
export async function ApprovalsSection({
  projectId,
  mode,
}: {
  projectId: string;
  mode: ProjectEditMode;
}) {
  const approvals = await getDb().projectApproval.findMany({ where: { projectId } });
  const byKind = new Map(approvals.map((a) => [a.kind, a]));
  const editable = mode === "full";

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">Approvals</h3>
        <p className="mt-1 text-sm text-slate-600">
          Approvals are optional for now. If you have them, add the number and attach the
          certificate so our team can verify it; verified approvals show a badge to buyers. Projects
          can go live without any.
          {!editable && " Approvals are locked right now."}
        </p>
      </div>

      <ul className="space-y-4">
        {KINDS.map(({ kind, label, help }) => {
          const approval = byKind.get(kind);
          return (
            <li
              key={kind}
              className="rounded-2xl border border-slate-200 bg-white p-5"
              data-approval-kind={kind}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold">{label}</h4>
                  <p className="text-sm text-slate-600">{help}</p>
                </div>
                {approval?.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                    <BadgeCheck className="size-3.5" aria-hidden="true" /> Verified
                  </span>
                )}
                {approval && !approval.verified && (
                  <span className="bg-surface rounded-full px-2.5 py-1 text-xs font-semibold text-slate-700">
                    Awaiting verification
                  </span>
                )}
              </div>

              <form
                action={saveApproval}
                className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="kind" value={kind} />
                <Field id={`${kind}-number`} label="Approval number">
                  <input
                    id={`${kind}-number`}
                    name="number"
                    defaultValue={approval?.number ?? ""}
                    disabled={!editable}
                    maxLength={60}
                    className={inputClass}
                  />
                </Field>
                <Field id={`${kind}-from`} label="Valid from">
                  <input
                    id={`${kind}-from`}
                    type="date"
                    name="validFrom"
                    defaultValue={day(approval?.validFrom ?? null)}
                    disabled={!editable}
                    className={inputClass}
                  />
                </Field>
                <Field id={`${kind}-till`} label="Valid until">
                  <input
                    id={`${kind}-till`}
                    type="date"
                    name="validTill"
                    defaultValue={day(approval?.validTill ?? null)}
                    disabled={!editable}
                    className={inputClass}
                  />
                </Field>
                {editable && (
                  <button type="submit" className={buttonClass("primary")}>
                    Save
                  </button>
                )}
              </form>

              {approval && (
                <div className="mt-4 space-y-3">
                  {approval.storageKey && (
                    <div className="bg-surface flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm">
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
                    </div>
                  )}
                  {approval.reviewNote && (
                    <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                      <span className="font-semibold">Reviewer&apos;s note:</span>{" "}
                      {approval.reviewNote}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <ProjectUpload
                      projectId={projectId}
                      kind="APPROVAL"
                      approval={kind}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      label={approval.storageKey ? "Replace certificate" : "Attach certificate"}
                      disabled={!editable}
                      hint="PDF or image, up to 5 MB"
                    />
                    {editable && (
                      <form action={deleteApproval}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="kind" value={kind} />
                        <ConfirmSubmit
                          message={`Remove the ${label}?`}
                          className={buttonClass("secondary")}
                        >
                          Remove
                        </ConfirmSubmit>
                      </form>
                    )}
                  </div>
                </div>
              )}
              {!approval && editable && (
                <p className="mt-3 text-xs text-slate-500">
                  Save the number first, then you can attach the certificate.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
