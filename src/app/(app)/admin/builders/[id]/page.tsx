import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { BuilderStatusBadge, DocumentStatusBadge } from "@/components/portal/status-badge";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { DOCUMENT_SPECS, unapprovedForVerification } from "@/lib/builders/documents";
import {
  BUILDER_TYPES,
  PROFILE_FIELDS,
  PROFILE_KEYS,
  buildChecklist,
  profileToFormValues,
} from "@/lib/builders/profile";
import { formatBytes } from "@/lib/storage/sniff";
import { formatDateTime } from "@/lib/format";
import { PLAN_LABELS } from "@/lib/plans";
import { decideBuilder, reviewDocument } from "./actions";

export const metadata = { title: "Review builder" };

export default async function AdminBuilderPage({
  params,
  searchParams,
}: PageProps<"/admin/builders/[id]">) {
  await requireUser({ returnTo: "/admin/builders", roles: ["ADMIN"] });
  const { id } = await params;
  const { saved, error } = await searchParams;

  const db = getDb();
  const builder = await db.builder.findUnique({
    where: { id },
    include: {
      documents: true,
      members: { include: { user: { select: { email: true, name: true } } } },
    },
  });
  if (!builder) notFound();

  const [auditEntries, duplicates] = await Promise.all([
    db.auditLog.findMany({
      where: { entity: "Builder", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    // The same PAN or GSTIN on another company is the classic sign of a duplicate or fake account.
    db.builder.findMany({
      where: {
        id: { not: id },
        OR: [
          ...(builder.pan ? [{ pan: builder.pan }] : []),
          ...(builder.gstin ? [{ gstin: builder.gstin }] : []),
        ],
      },
      select: { id: true, companyName: true, status: true },
    }),
  ]);

  const actorIds = [...new Set(auditEntries.map((e) => e.actorId).filter((v): v is string => !!v))];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, email: true },
  });
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));

  const checklist = buildChecklist(builder, builder.documents);
  const values = profileToFormValues(builder);
  const documentByKind = new Map(builder.documents.map((d) => [d.kind, d]));
  const readyToApprove =
    checklist.profile.done && unapprovedForVerification(builder.documents).length === 0;
  const underReview = builder.status === "SUBMITTED";
  const owner = builder.members.find((m) => m.role === "OWNER")?.user;

  const typeLabel = BUILDER_TYPES.find((t) => t.value === builder.type)?.label;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="builders" />
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/builders" className="text-sm font-semibold text-teal-700 underline">
          Builders
        </Link>
        <span aria-hidden="true">/</span>
        <h2 className="text-xl font-bold">{builder.companyName ?? "(no name yet)"}</h2>
        <BuilderStatusBadge status={builder.status} />
      </div>

      {saved && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-teal-50 p-4 text-sm font-medium text-teal-700"
        >
          <CheckCircle2 className="size-5" aria-hidden="true" /> {saved}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700"
        >
          <AlertTriangle className="size-5" aria-hidden="true" /> {error}
        </p>
      )}

      {duplicates.length > 0 && (
        <section
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700"
        >
          <p className="font-semibold">
            Possible duplicate: the same PAN or GSTIN is used by another company.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {duplicates.map((other) => (
              <li key={other.id}>
                <Link href={`/admin/builders/${other.id}`} className="font-semibold underline">
                  {other.companyName ?? "(no name)"}
                </Link>{" "}
                ({other.status})
              </li>
            ))}
          </ul>
        </section>
      )}

      {checklist.profile.problems.length > 0 && (
        <section
          role="alert"
          className="rounded-xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-700"
        >
          <p className="font-semibold">Check before approving:</p>
          <ul className="mt-1 list-disc pl-5">
            {checklist.profile.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Company details</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Account owner</dt>
            <dd className="font-medium">
              {owner?.name ?? "—"} <span className="text-slate-500">{owner?.email}</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Interested plan</dt>
            <dd className="font-medium">
              {builder.interestedPlan ? PLAN_LABELS[builder.interestedPlan] : "—"}
            </dd>
          </div>
          {PROFILE_KEYS.map((key) => (
            <div key={key} className={key === "about" ? "sm:col-span-2" : undefined}>
              <dt className="text-slate-500">{PROFILE_FIELDS[key].label}</dt>
              <dd className="font-medium break-words whitespace-pre-wrap">
                {key === "type" ? (typeLabel ?? "—") : values[key] || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Documents</h2>
        {underReview && (
          <p className="mt-1 text-sm text-slate-600">
            Open each file, then approve it or send it back with a note. No document is mandatory,
            but every document that was uploaded must be approved before the builder can be
            approved.
          </p>
        )}
        <ul className="mt-4 space-y-4">
          {DOCUMENT_SPECS.map((spec) => {
            const document = documentByKind.get(spec.kind);
            return (
              <li
                key={spec.kind}
                className="rounded-xl border border-slate-200 p-4"
                data-document-kind={spec.kind}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {spec.label}
                    {!spec.required && (
                      <span className="ml-2 text-xs font-medium text-slate-500">Optional</span>
                    )}
                  </p>
                  {document ? (
                    <DocumentStatusBadge status={document.status} />
                  ) : (
                    <span
                      className={`text-xs font-semibold ${spec.required ? "text-red-600" : "text-slate-500"}`}
                    >
                      Not uploaded
                    </span>
                  )}
                </div>

                {document && (
                  <>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <FileText className="size-4 text-slate-500" aria-hidden="true" />
                      <a
                        href={`/api/documents/${document.id}`}
                        target="_blank"
                        rel="noopener"
                        className="font-semibold text-teal-700 underline"
                      >
                        {document.originalName}
                      </a>
                      <span className="text-slate-500">
                        {formatBytes(document.sizeBytes)}, uploaded{" "}
                        {formatDateTime(document.createdAt)}
                      </span>
                    </p>
                    {document.reviewNote && (
                      <p className="mt-2 text-sm text-red-700">
                        Note sent to builder: {document.reviewNote}
                      </p>
                    )}
                    {underReview && (
                      <form action={reviewDocument} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="builderId" value={builder.id} />
                        <input type="hidden" name="documentId" value={document.id} />
                        <div className="min-w-48 flex-1">
                          <label htmlFor={`note-${document.id}`} className="sr-only">
                            Note for {spec.label} (required when sending back)
                          </label>
                          <input
                            id={`note-${document.id}`}
                            name="note"
                            type="text"
                            maxLength={1000}
                            placeholder="Note to builder (needed when sending back)"
                            className={inputClass}
                          />
                        </div>
                        <button name="decision" value="approve" className={buttonClass("primary")}>
                          Approve
                        </button>
                        <button name="decision" value="reject" className={buttonClass("secondary")}>
                          Send back
                        </button>
                      </form>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Decision</h2>

        {builder.reviewNote && (
          <p className="mt-2 text-sm text-slate-600">
            Last note to the builder:{" "}
            <span className="whitespace-pre-wrap">{builder.reviewNote}</span>
          </p>
        )}

        {builder.status === "SUBMITTED" && (
          <form action={decideBuilder} className="mt-4 space-y-4">
            <input type="hidden" name="builderId" value={builder.id} />
            <div>
              <label htmlFor="decision-note" className="block text-sm font-semibold">
                Note to the builder
              </label>
              <p className="text-xs text-slate-500">
                Required when asking for changes or rejecting.
              </p>
              <textarea
                id="decision-note"
                name="note"
                rows={3}
                maxLength={1000}
                className={`${inputClass} mt-1.5`}
              />
            </div>
            {!readyToApprove && (
              <p className="text-sm text-amber-700">
                Approve is available once the profile has no conflicts and every uploaded document
                is approved.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                name="action"
                value="APPROVE"
                disabled={!readyToApprove}
                className={`${buttonClass("primary")} disabled:cursor-not-allowed`}
              >
                Approve builder
              </button>
              <button name="action" value="REQUEST_CHANGES" className={buttonClass("accent")}>
                Request changes
              </button>
              <button name="action" value="REJECT" className={buttonClass("secondary")}>
                Reject
              </button>
            </div>
          </form>
        )}

        {builder.status === "VERIFIED" && (
          <form action={decideBuilder} className="mt-4 space-y-3">
            <input type="hidden" name="builderId" value={builder.id} />
            <label htmlFor="suspend-note" className="block text-sm font-semibold">
              Reason for suspending
            </label>
            <textarea
              id="suspend-note"
              name="note"
              rows={2}
              maxLength={1000}
              className={inputClass}
            />
            <button name="action" value="SUSPEND" className={buttonClass("secondary")}>
              Suspend builder
            </button>
          </form>
        )}

        {builder.status === "SUSPENDED" && (
          <form action={decideBuilder} className="mt-4">
            <input type="hidden" name="builderId" value={builder.id} />
            <button name="action" value="REINSTATE" className={buttonClass("primary")}>
              Reinstate builder
            </button>
          </form>
        )}

        {(builder.status === "DRAFT" ||
          builder.status === "CHANGES_REQUESTED" ||
          builder.status === "REJECTED") && (
          <p className="mt-3 text-sm text-slate-600">
            {builder.status === "DRAFT"
              ? "The builder has not submitted this application yet."
              : builder.status === "CHANGES_REQUESTED"
                ? "Waiting for the builder to make the requested changes and submit again."
                : "This application was rejected."}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">History</h2>
        {auditEntries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No activity yet.</p>
        ) : (
          <ol className="mt-4 divide-y divide-slate-100 text-sm">
            {auditEntries.map((entry) => (
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
