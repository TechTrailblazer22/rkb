import { requireUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { homePathForRole } from "@/lib/auth/roles";
import { createBuilderAccount } from "./actions";

export const metadata = { title: "List your project" };

export default async function StartListingPage() {
  const user = await requireUser({ returnTo: "/start-listing" });
  if (user.role !== "BUYER") redirect(homePathForRole(user.role));

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

      <form action={createBuilderAccount} className="mt-8">
        <button type="submit" className={buttonClass("primary")}>
          Create my builder account
        </button>
      </form>
    </div>
  );
}
