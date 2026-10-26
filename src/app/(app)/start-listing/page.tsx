import { requireUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { homePathForMode } from "@/lib/auth/mode";
import { createBuilderAccount } from "./actions";

export const metadata = { title: "List your project" };

export default async function StartListingPage() {
  const user = await requireUser({ returnTo: "/start-listing" });
  // Staff have no builder account to create. Someone who already has one goes to it (through the
  // switch, if they are currently using their buyer account).
  if (user.mode === "admin") redirect(homePathForMode("admin"));
  if (user.canBuild)
    redirect(user.mode === "builder" ? "/portal" : "/switch?to=builder&next=%2Fportal");

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-bold">List your project on RKB</h1>
      <p className="mt-2 text-sm text-slate-600">
        Create your builder account to list projects, manage live plot inventory and receive buyer
        leads. There is no commission on your sales.
      </p>

      <ol className="mt-6 space-y-3 text-sm">
        {[
          "Create your builder account (this step)",
          "Add your company profile and verification documents",
          "List your project: layout, plots, photos and approvals",
          "Go live after verification and start receiving leads",
        ].map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="bg-navy-900 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-amber-500">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <p
        data-testid="both-accounts-note"
        className="bg-surface mt-6 rounded-lg p-4 text-sm text-slate-700"
      >
        <span className="font-semibold">Your buyer account stays as it is.</span> This adds a
        builder account to the same email address. Once it exists you can switch between the two
        from the top of any page, without logging out.
      </p>

      <form action={createBuilderAccount} className="mt-6">
        <button type="submit" className={buttonClass("primary")}>
          Create my builder account
        </button>
      </form>
    </div>
  );
}
