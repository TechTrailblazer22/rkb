import { buttonClass } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Sign-in problem" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  "email-unverified": {
    title: "Please verify your email",
    body: "We sent a verification link to your email address. Open it (check spam too), then come back here and press Continue. You will not need to enter your password again.",
  },
  "email-conflict": {
    title: "This email is already registered",
    body: "An account with this email already exists using a different sign-in method (for example Google instead of a password). Log in with the method you used the first time.",
  },
  "no-email": {
    title: "We could not read your email address",
    body: "Your sign-in provider did not share an email address. Please log in with a method that does.",
  },
};

export default async function AccountProblemPage({ searchParams }: PageProps<"/account-problem">) {
  const { reason } = await searchParams;
  const key = typeof reason === "string" ? reason : "";
  const message = MESSAGES[key] ?? {
    title: "Something went wrong with sign-in",
    body: "Please log out and try again.",
  };
  const unverified = key === "email-unverified";
  const user = unverified ? await getSessionUser() : null;

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-bold">{message.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{message.body}</p>
      {user?.email && (
        <p className="mt-3 text-sm">
          Verification link sent to <span className="font-semibold">{user.email}</span>
        </p>
      )}

      {/* plain <a> links: the Auth0 SDK needs full navigations, not client-side routing */}
      <div className="mt-6 flex flex-wrap gap-3">
        {unverified && (
          // The Auth0 session from sign-up is still alive, so this signs in silently and
          // picks up the new "email verified" status. Logging out first would ask for the
          // password again.
          <a href="/auth/login?returnTo=%2Fdashboard" className={buttonClass("primary")}>
            I&apos;ve verified my email, continue
          </a>
        )}
        <a href="/logout" className={buttonClass(unverified ? "secondary" : "primary")}>
          {unverified ? "Use a different account" : "Log out and try again"}
        </a>
      </div>
    </div>
  );
}
