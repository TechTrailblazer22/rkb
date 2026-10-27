"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

/** Posts a progress update (a note and an optional photo) and refreshes the list. */
export function ProgressForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/builder/projects/${projectId}/progress`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        formRef.current?.reset();
        setMessage({ ok: true, text: "Posted. People who saved this project are being told." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: body.error ?? "The update could not be posted." });
      }
    } catch {
      setMessage({ ok: false, text: "The update could not be posted. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3" data-testid="progress-form">
      <div>
        <label htmlFor="progress-note" className="block text-sm font-semibold">
          What has happened?
        </label>
        <textarea
          id="progress-note"
          name="note"
          rows={3}
          required
          minLength={5}
          maxLength={500}
          placeholder="For example: Internal roads laid in phase 1, street lights next week."
          className={`${inputClass} mt-1.5`}
        />
      </div>
      <div>
        <label htmlFor="progress-photo" className="block text-sm font-semibold">
          A photo{" "}
          <span className="font-normal text-slate-500">
            (optional, JPG, PNG or WebP up to 5 MB)
          </span>
        </label>
        <input
          id="progress-photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="mt-1.5 block w-full text-sm"
        />
      </div>
      <button type="submit" disabled={busy} className={buttonClass("primary")}>
        {busy ? "Posting..." : "Post the update"}
      </button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm font-medium ${message.ok ? "text-teal-800" : "text-red-700"}`}
          data-testid="progress-message"
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
