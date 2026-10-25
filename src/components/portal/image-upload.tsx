"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

// Logo or cover picture. Posts to the upload route, which checks the file's real type and size.
export function ImageUpload({
  kind,
  label,
  currentUrl,
  disabled,
  shape,
}: {
  kind: "LOGO" | "COVER";
  label: string;
  currentUrl: string | null;
  disabled: boolean;
  shape: "square" | "wide";
}) {
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

  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-2 flex items-center gap-4">
        <div
          className={`bg-surface flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 ${
            shape === "square" ? "size-24" : "h-24 w-40"
          }`}
        >
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS
            <img src={currentUrl} alt={`${label} preview`} className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-7 text-slate-400" aria-hidden="true" />
          )}
        </div>
        <div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id={`upload-${kind}`}
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <label
            htmlFor={`upload-${kind}`}
            className={`${buttonClass("secondary")} ${disabled || busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          >
            {busy ? "Uploading..." : currentUrl ? "Replace" : "Upload"}
          </label>
          <p className="mt-1.5 text-xs text-slate-500">JPG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
