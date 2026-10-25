import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Sign-in problem" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  "email-unverified": {
    title: "Please verify your email",
    body: "We sent a verification link to your email address. Open it, then log in again.",
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
  const message = MESSAGES[typeof reason === "string" ? reason : ""] ?? {
    title: "Something went wrong with sign-in",
    body: "Please log out and try again.",
  };

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-bold">{message.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{message.body}</p>
      {/* plain <a>: the Auth0 SDK needs a full navigation */}
      <a href="/auth/logout" className={`${buttonClass("primary")} mt-6`}>
        Log out and try again
      </a>
    </div>
  );
}
