"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { submitProject, type SubmitState } from "@/app/(app)/portal/projects/actions";

export function SubmitProjectPanel({
  projectId,
  canSubmit,
  blockedReason,
}: {
  projectId: string;
  canSubmit: boolean;
  /** Why submitting is not possible, when it is not a missing checklist item. */
  blockedReason?: string;
}) {
  const [result, action, pending] = useActionState<SubmitState, FormData>(
    (previous) => submitProject(projectId, previous),
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <button
        type="submit"
        disabled={!canSubmit || pending}
        className={`${buttonClass("accent", "lg")} disabled:cursor-not-allowed`}
      >
        {pending ? "Submitting..." : "Submit for review"}
      </button>
      {blockedReason && <p className="text-sm text-amber-700">{blockedReason}</p>}
      {!blockedReason && !canSubmit && (
        <p className="text-sm text-slate-600">
          Fix the conflicts listed above to enable submitting.
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {result.message}
        </p>
      )}
    </form>
  );
}
