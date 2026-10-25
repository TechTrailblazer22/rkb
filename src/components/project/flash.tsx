import { AlertTriangle, CheckCircle2 } from "lucide-react";

const SAVED_TEXT: Record<string, string> = {
  submitted: "Submitted for review. We will email you when there is a decision.",
  reopened: "The project is offline for editing. Submit it again when you are done.",
  archived: "The project was archived.",
  cover: "Cover photo updated.",
  removed: "Removed.",
  RERA: "RERA approval saved.",
  TNCP: "TNCP approval saved.",
  MUNICIPAL: "Municipal approval saved.",
  BANK_LOAN: "Bank loan approval saved.",
  OTHER: "Approval saved.",
};

/** Result of the last action, passed in the address. Always shown as plain text. */
export function Flash({ saved, error }: { saved?: string | string[]; error?: string | string[] }) {
  const savedText = typeof saved === "string" ? (SAVED_TEXT[saved] ?? saved).slice(0, 200) : null;
  const errorText = typeof error === "string" ? error.slice(0, 300) : null;
  if (!savedText && !errorText) return null;

  return errorText ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      {errorText}
    </p>
  ) : (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl bg-teal-50 p-4 text-sm font-medium text-teal-700"
    >
      <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      {savedText}
    </p>
  );
}
