import { BadgeCheck } from "lucide-react";
import type { BuilderStatus, DocumentStatus } from "@/generated/prisma/enums";
import { statusLabel } from "@/lib/builders/status";

const builderTone: Record<BuilderStatus, string> = {
  DRAFT: "bg-surface text-slate-700",
  SUBMITTED: "bg-amber-50 text-amber-700",
  CHANGES_REQUESTED: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-teal-50 text-teal-700",
  REJECTED: "bg-red-50 text-red-700",
  SUSPENDED: "bg-red-50 text-red-700",
};

export function BuilderStatusBadge({ status }: { status: BuilderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${builderTone[status]}`}
    >
      {status === "VERIFIED" && <BadgeCheck className="size-3.5" aria-hidden="true" />}
      {statusLabel[status]}
    </span>
  );
}

const documentTone: Record<DocumentStatus, { label: string; className: string }> = {
  PENDING: { label: "Awaiting review", className: "bg-surface text-slate-700" },
  APPROVED: { label: "Approved", className: "bg-teal-50 text-teal-700" },
  REJECTED: { label: "Needs a new file", className: "bg-red-50 text-red-700" },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const tone = documentTone[status];
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone.className}`}
    >
      {tone.label}
    </span>
  );
}
