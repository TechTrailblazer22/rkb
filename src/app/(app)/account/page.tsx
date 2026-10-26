import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser({ returnTo: "/account", roles: ["BUYER"] });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Welcome, {user.name ?? user.email}</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Your account</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Account type</dt>
            <dd className="font-medium">Buyer</dd>
          </div>
        </dl>
        <Link href="/account/shortlist" className={`${buttonClass("secondary")} mt-4`}>
          Saved projects
        </Link>
        <p className="mt-4 text-sm text-slate-500">
          Enquiries and bookings will appear here as they are released.
        </p>
      </section>

      <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6">
        <h2 className="font-semibold">Are you a builder or developer?</h2>
        <p className="mt-1 text-sm text-slate-700">
          List your projects, take live plot enquiries and bookings. No commission on your sales.
        </p>
        <Link href="/start-listing" className={`${buttonClass("accent")} mt-4`}>
          List your project
        </Link>
      </section>
    </div>
  );
}
