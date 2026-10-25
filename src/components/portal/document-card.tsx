"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { DocumentStatusBadge } from "@/components/portal/status-badge";
import { buttonClass } from "@/components/ui/button";
import { formatBytes } from "@/lib/storage/sniff";
import type { DocumentStatus } from "@/generated/prisma/enums";

export type DocumentCardProps = {
  kind: string;
  label: string;
  help: string;
  required: boolean;
  canEdit: boolean;
  document: {
    id: string;
    originalName: string;
    sizeBytes: number;
    status: DocumentStatus;
    reviewNote: string | null;
  } | null;
};

export function DocumentCard({
  kind,
  label,
  help,
  required,
  canEdit,
  document,
}: DocumentCardProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const response = await fetch("/api/builder/upload", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Upload failed. Please try again.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const rejected = document?.status === "REJECTED";

  return (
    <li
      className={`rounded-2xl border bg-white p-5 ${rejected ? "border-red-300" : "border-slate-200"}`}
      data-document-kind={kind}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">
            {label}
            {required ? (
              <span className="text-red-600" aria-hidden="true">
                {" "}
                *
              </span>
            ) : (
              <span className="ml-2 text-xs font-medium text-slate-500">Optional</span>
            )}
          </h3>
          <p className="mt-1 text-sm text-slate-600">{help}</p>
        </div>
        {document && <DocumentStatusBadge status={document.status} />}
      </div>

      {document ? (
        <div className="bg-surface mt-4 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm">
          <FileText className="size-5 shrink-0 text-slate-500" aria-hidden="true" />
          <a
            href={`/api/documents/${document.id}`}
            target="_blank"
            rel="noopener"
            className="min-w-0 flex-1 truncate font-semibold text-teal-700 underline"
          >
            {document.originalName}
          </a>
          <span className="text-slate-500">{formatBytes(document.sizeBytes)}</span>
        </div>
      ) : null}

      {rejected && document?.reviewNote && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">Reviewer&apos;s note:</span> {document.reviewNote}
        </p>
      )}

      {canEdit && (
        <div className="mt-4">
          <input
            ref={input}
            id={`file-${kind}`}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <label
            htmlFor={`file-${kind}`}
            className={`${buttonClass(document ? "secondary" : "primary")} ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          >
            <Upload className="size-4" aria-hidden="true" />
            {busy ? "Uploading..." : document ? "Replace file" : "Upload file"}
          </label>
          <span className="ml-3 text-xs text-slate-500">PDF, JPG, PNG or WebP, up to 5 MB</span>
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
