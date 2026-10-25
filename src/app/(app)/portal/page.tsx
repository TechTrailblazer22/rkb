import Link from "next/link";
import { AlertTriangle, BadgeCheck, CheckCircle2, Circle, Clock } from "lucide-react";
import { ProgressRing } from "@/components/ui/progress-ring";
import { buttonClass } from "@/components/ui/button";
import { requireBuilderContext } from "@/lib/builders/context";
import { REQUIRED_DOCUMENT_KINDS, documentLabel } from "@/lib/builders/documents";

export const metadata = { title: "Builder portal" };

function Row({
  done,
  title,
  detail,
  href,
  action,
}: {
  done: boolean;
  title: string;
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <li className="flex items-center gap-4 py-4">
      {done ? (
        <CheckCircle2 className="size-6 shrink-0 text-teal-500" aria-label="Done" />
      ) : (
        <Circle className="size-6 shrink-0 text-slate-300" aria-label="To do" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-slate-600">{detail}</p>
      </div>
      <Link href={href} className={buttonClass(done ? "secondary" : "primary")}>
        {done ? "Review" : action}
      </Link>
    </li>
  );
}

export default async function PortalPage() {
  const { builder, documents, checklist } = await requireBuilderContext("/portal");
  const { status } = builder;
  const rejectedDocuments = documents.filter((d) => d.status === "REJECTED");
  const uploadedRequired = REQUIRED_DOCUMENT_KINDS.length - checklist.documents.missing.length;

  return (
    <div className="space-y-6">
      {status === "VERIFIED" && (
        <section className="flex gap-4 rounded-2xl border border-teal-500/40 bg-teal-50 p-6">
          <BadgeCheck className="size-8 shrink-0 text-teal-700" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold">You are a Verified Builder</h2>
            <p className="mt-1 text-sm text-slate-700">
              Your verification is complete. Listing your projects, with plots, photos and
              approvals, is the next step and arrives in the next release. You can still update how
              your company is presented from the Company profile tab.
            </p>
          </div>
        </section>
      )}

      {status === "SUBMITTED" && (
        <section className="flex gap-4 rounded-2xl border border-amber-500/40 bg-amber-50 p-6">
          <Clock className="size-8 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold">Your application is under review</h2>
            <p className="mt-1 text-sm text-slate-700">
              We are checking your details and documents. You will get an email when there is a
              result. Your application is locked while it is being reviewed.
            </p>
          </div>
        </section>
      )}

      {status === "CHANGES_REQUESTED" && (
        <section className="rounded-2xl border border-amber-500/50 bg-amber-50 p-6">
          <div className="flex gap-4">
            <AlertTriangle className="size-8 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold">A few changes are needed</h2>
              <p className="mt-1 text-sm text-slate-700">Message from our reviewer:</p>
              <blockquote className="mt-2 border-l-4 border-amber-500 bg-white/70 px-4 py-3 text-sm whitespace-pre-wrap">
                {builder.reviewNote ?? "Please review your details and documents."}
              </blockquote>
              {rejectedDocuments.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm">
                  {rejectedDocuments.map((doc) => (
                    <li key={doc.id}>
                      <span className="font-semibold">{documentLabel(doc.kind)}:</span>{" "}
                      {doc.reviewNote ?? "please upload a clearer or correct file."}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-sm text-slate-700">
                Make the changes below, then submit again from the Review and submit tab.
              </p>
            </div>
          </div>
        </section>
      )}

      {(status === "REJECTED" || status === "SUSPENDED") && (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-6">
          <h2 className="text-lg font-bold">
            {status === "REJECTED"
              ? "We could not verify this application"
              : "This account is suspended"}
          </h2>
          {builder.reviewNote && (
            <blockquote className="mt-3 border-l-4 border-red-400 bg-white/70 px-4 py-3 text-sm whitespace-pre-wrap">
              {builder.reviewNote}
            </blockquote>
          )}
          <p className="mt-3 text-sm text-slate-700">
            If you think this is a mistake, please contact support.
          </p>
        </section>
      )}

      {(status === "DRAFT" || status === "CHANGES_REQUESTED") && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center gap-6">
            <ProgressRing percent={checklist.percent} />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">Get your company verified</h2>
              <p className="mt-1 text-sm text-slate-600">
                Fill in each step at your own pace. Everything saves automatically, and you can
                leave and come back at any time.
              </p>
            </div>
          </div>

          <ul className="mt-4 divide-y divide-slate-100">
            <Row
              done={checklist.profile.done}
              title="Company profile"
              detail={
                checklist.profile.done
                  ? "All required details are filled in."
                  : checklist.profile.problems.length > 0
                    ? checklist.profile.problems[0]
                    : `${checklist.profile.missing.length} required ${checklist.profile.missing.length === 1 ? "item" : "items"} left`
              }
              href="/portal/profile"
              action="Continue"
            />
            <Row
              done={checklist.documents.done}
              title="Verification documents"
              detail={
                checklist.documents.rejected.length > 0
                  ? `${checklist.documents.rejected.length} document needs a new file`
                  : `${uploadedRequired} of ${REQUIRED_DOCUMENT_KINDS.length} required documents uploaded`
              }
              href="/portal/documents"
              action="Upload"
            />
            <Row
              done={checklist.plan.done}
              title="Choose a plan"
              detail={
                checklist.plan.done
                  ? "No payment is taken now."
                  : "Tell us which plan suits you. No payment is taken now."
              }
              href="/portal/plan"
              action="Choose"
            />
            <Row
              done={false}
              title="Submit for verification"
              detail={
                checklist.canSubmit
                  ? "Everything is ready. Send it to our team."
                  : "Available once the steps above are complete."
              }
              href="/portal/review"
              action="Review"
            />
          </ul>
        </section>
      )}
    </div>
  );
}
