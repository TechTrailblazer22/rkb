"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { submitForVerification, type SubmitResult } from "@/app/(app)/portal/actions";

export function SubmitPanel({ canSubmit }: { canSubmit: boolean }) {
  const [result, action, pending] = useActionState<SubmitResult, FormData>(
    (previous) => submitForVerification(previous),
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <button
        type="submit"
        disabled={!canSubmit || pending}
        className={`${buttonClass("accent", "lg")} disabled:cursor-not-allowed`}
      >
        {pending ? "Submitting..." : "Submit for verification"}
      </button>
      {!canSubmit && (
        <p className="text-sm text-slate-600">Complete the items above to enable submitting.</p>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {result.message}
        </p>
      )}
    </form>
  );
}
