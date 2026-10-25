"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

type Props = {
  projectId: string;
  kind: "PHOTO" | "LAYOUT" | "BROCHURE" | "APPROVAL";
  /** For APPROVAL: which approval the document belongs to (RERA, TNCP...). */
  approval?: string;
  accept: string;
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: string;
};

const TARGET_BYTES = 1_500_000;
const MAX_SIDE = 1800;

/**
 * Phone photos are often 4 to 8 MB. Shrinking them here, before they are sent, makes uploads
 * quick on a mobile connection and keeps storage small. Anything that cannot be shrunk is sent
 * as it is.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < TARGET_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function ProjectUpload({
  projectId,
  kind,
  approval,
  accept,
  label,
  multiple,
  disabled,
  hint,
}: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `upload-${kind}${approval ? `-${approval}` : ""}`;

  async function send(files: File[]) {
    setError(null);
    const failures: string[] = [];
    for (const [index, original] of files.entries()) {
      setBusy(files.length > 1 ? `Uploading ${index + 1} of ${files.length}...` : "Uploading...");
      try {
        const file = kind === "PHOTO" ? await shrinkImage(original) : original;
        const body = new FormData();
        body.set("kind", kind);
        if (approval) body.set("approval", approval);
        body.set("file", file);
        const response = await fetch(`/api/builder/projects/${projectId}/upload`, {
          method: "POST",
          body,
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) failures.push(`${original.name}: ${result.error ?? "upload failed"}`);
      } catch {
        failures.push(`${original.name}: could not be uploaded. Check your connection.`);
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    if (failures.length > 0) setError(failures.join(" "));
    router.refresh();
  }

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        disabled={disabled || busy !== null}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void send(files);
        }}
      />
      <label
        htmlFor={id}
        className={`${buttonClass("secondary")} ${disabled || busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
      >
        <Upload className="size-4" aria-hidden="true" />
        {busy ?? label}
      </label>
      {hint && <span className="ml-3 text-xs text-slate-500">{hint}</span>}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
