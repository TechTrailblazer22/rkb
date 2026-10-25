import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { SubmitPanel } from "@/components/portal/submit-panel";
import { requireBuilderContext } from "@/lib/builders/context";
import { documentLabel } from "@/lib/builders/documents";
import { PLAN_LABELS } from "@/lib/plans";

export const metadata = { title: "Review and submit" };

function Item({ ok, children, href }: { ok: boolean; children: React.ReactNode; href?: string }) {
  const content =
    href && !ok ? (
      <Link href={href} className="font-semibold text-teal-700 underline">
        {children}
      </Link>
    ) : (
      children
    );
  return (
    <li className="flex items-start gap-3 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal-500" aria-label="Done" />
      ) : (
        <XCircle className="mt-0.5 size-5 shrink-0 text-red-500" aria-label="Missing" />
      )}
      <span>{content}</span>
    </li>
  );
}

export default async function ReviewPage() {
  const { builder, checklist, mode } = await requireBuilderContext("/portal/review");
  const editable = mode === "full";

  if (!editable) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">
          {builder.status === "SUBMITTED"
            ? "Your application is with our team"
            : "Nothing to submit right now"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {builder.status === "SUBMITTED"
            ? "You will get an email when the review is complete."
            : "Your application cannot be submitted in its current state."}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Before you submit</h2>
        <p className="mt-1 text-sm text-slate-600">
          Once you submit, your application is locked while our team reviews it.
        </p>

        <ul className="mt-5 space-y-3">
          <Item ok={checklist.profile.missing.length === 0} href="/portal/profile">
            {checklist.profile.missing.length === 0
              ? "All required company details are filled in"
              : `Company profile: still needed: ${checklist.profile.missing.map((m) => m.label).join(", ")}`}
          </Item>
          {checklist.profile.problems.map((problem) => (
            <Item key={problem} ok={false} href="/portal/profile">
              {problem}
            </Item>
          ))}
          <Item ok={checklist.documents.missing.length === 0} href="/portal/documents">
            {checklist.documents.missing.length === 0
              ? "All required documents are uploaded"
              : `Documents still needed: ${checklist.documents.missing.map(documentLabel).join(", ")}`}
          </Item>
          {checklist.documents.rejected.length > 0 && (
            <Item ok={false} href="/portal/documents">
              Replace the document(s) our reviewer sent back:{" "}
              {checklist.documents.rejected.map(documentLabel).join(", ")}
            </Item>
          )}
          <Item ok={checklist.plan.done} href="/portal/plan">
            {checklist.plan.done
              ? `Plan chosen: ${builder.interestedPlan ? PLAN_LABELS[builder.interestedPlan] : ""}`
              : "Choose a plan"}
          </Item>
        </ul>
      </section>

      <SubmitPanel canSubmit={checklist.canSubmit} />
    </div>
  );
}
