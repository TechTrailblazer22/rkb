import { requireUser } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/auth/paths";
import { buttonClass } from "@/components/ui/button";
import { acceptTerms } from "./actions";

export const metadata = { title: "Welcome" };

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const params = await searchParams;
  const returnToParam = typeof params.returnTo === "string" ? params.returnTo : undefined;
  const returnTo = safeReturnTo(returnToParam, "");
  const showError = params.error === "accept";

  const user = await requireUser({ returnTo: "/welcome", consent: false });

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Welcome{user.name ? `, ${user.name}` : ""}</h1>
      <p className="mt-2 text-sm text-slate-600">
        One last step before you continue. Please review how RKB Platform uses your information.
      </p>

      <form action={acceptTerms} className="mt-6 space-y-5">
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="accept"
            className="mt-0.5 size-4 accent-teal-700"
            aria-describedby={showError ? "accept-error" : undefined}
          />
          <span>
            I agree to the{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener"
              className="font-semibold text-teal-700 underline"
            >
              Terms of Use
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener"
              className="font-semibold text-teal-700 underline"
            >
              Privacy Notice
            </a>
            . I understand that when I send an enquiry, my contact details are shared with the
            builder I contact.
          </span>
        </label>

        {showError && (
          <p id="accept-error" role="alert" className="text-sm font-medium text-red-600">
            Please tick the box to continue.
          </p>
        )}

        <button type="submit" className={buttonClass("primary")}>
          Agree and continue
        </button>
      </form>
    </div>
  );
}
