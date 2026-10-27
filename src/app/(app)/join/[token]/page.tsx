import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { previewInvite, roleLabel } from "@/lib/team/service";
import { acceptInvitation } from "./actions";

export const metadata = { title: "Join a team", robots: { index: false } };

const problems: Record<string, string> = {
  not_found: "This invitation link is not valid. Ask the owner to send you a new one.",
  used: "This invitation has already been used.",
  expired: "This invitation has expired. Ask the owner to send you a new one.",
  wrong_email: "This invitation was sent to a different email address.",
  not_allowed: "Staff accounts cannot join a company's team.",
  in_a_company: "Your account already belongs to a company, and an account can belong to one.",
  no_seats: "The company has no free seat at the moment. Ask the owner to make room.",
};

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const user = await requireUser({ returnTo: `/join/${token}` });
  const preview = await previewInvite(getDb(), token);
  const mismatch = preview.ok && preview.email !== user.email.toLowerCase();
  const message =
    typeof error === "string" && Object.hasOwn(problems, error)
      ? problems[error]
      : !preview.ok
        ? problems[preview.code]
        : null;

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Join a team</h1>

      {message && (
        <p
          role="alert"
          data-testid="join-problem"
          className="mt-4 text-sm font-medium text-red-700"
        >
          {message}
        </p>
      )}

      {preview.ok && (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            You have been invited to join <strong>{preview.companyName ?? "a company"}</strong> on
            RKB Platform as <strong>{roleLabel[preview.role].toLowerCase()}</strong>.
          </p>
          {mismatch ? (
            <>
              <p data-testid="join-mismatch" className="text-red-700">
                The invitation was sent to <strong>{preview.email}</strong>, but you are signed in
                as <strong>{user.email}</strong>. Log out and log in with {preview.email} to accept
                it.
              </p>
              <a href="/logout" className={buttonClass("secondary")}>
                Log out
              </a>
            </>
          ) : (
            <form action={acceptInvitation.bind(null, token)}>
              <p className="bg-surface mb-4 rounded-lg p-4 text-slate-700">
                Your buyer account stays as it is. This adds the company as a builder account on the
                same email, and you can switch between the two from the top of any page.
              </p>
              <button type="submit" className={buttonClass("primary")}>
                Accept the invitation
              </button>
            </form>
          )}
        </div>
      )}

      {!preview.ok && (
        <Link href="/" className={`${buttonClass("secondary")} mt-5`}>
          Back to the home page
        </Link>
      )}
    </div>
  );
}
