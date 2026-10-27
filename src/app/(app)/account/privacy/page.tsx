import { Download } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { requireUser } from "@/lib/auth/session";
import { deleteMyAccount } from "./actions";

export const metadata = { title: "Your data and privacy" };

export default async function PrivacyPage({ searchParams }: PageProps<"/account/privacy">) {
  await requireUser({ returnTo: "/account/privacy", roles: ["BUYER"] });
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Your data and privacy</h1>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="download-data"
      >
        <h2 className="text-lg font-bold">Get a copy of your data</h2>
        <p className="mt-1 text-sm text-slate-600">
          Everything we hold about you: your details, the projects you saved, your enquiries and the
          messages you sent, your reviews and your bookings. It does not include notes a builder
          made about you.
        </p>
        <a
          href="/api/me/export"
          className={`${buttonClass("secondary")} mt-4`}
          data-testid="export-data"
        >
          <Download className="size-4" aria-hidden="true" /> Download my data
        </a>
      </section>

      <section
        className="rounded-2xl border border-red-200 bg-white p-5 sm:p-6"
        data-testid="delete-account"
      >
        <h2 className="text-lg font-bold text-red-800">Delete my account</h2>
        <p className="mt-1 text-sm text-slate-700">
          This removes your name, mobile number and email from our records, your saved projects and
          your reviews, and you can no longer log in to this account. Builders keep their enquiry
          records, but without your details. A booking that has been paid (or is waiting for a
          refund) must be settled first. Logging in again later starts a new, empty account.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Your login with Google or email and password is held by our sign-in provider; this does
          not delete that.
        </p>
        {typeof error === "string" && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            data-testid="delete-error"
          >
            {error}
          </p>
        )}
        <form action={deleteMyAccount} className="mt-4 space-y-3">
          <Field id="confirm-delete" label="Type DELETE to confirm">
            <input id="confirm-delete" name="confirm" autoComplete="off" className={inputClass} />
          </Field>
          <button
            type="submit"
            className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800"
          >
            Delete my account
          </button>
        </form>
      </section>
    </div>
  );
}
