import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });

  const db = getDb();
  const [users, builders] = await Promise.all([db.user.count(), db.builder.count()]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">Users</p>
          <p className="mt-1 text-3xl font-bold">{users}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">Builders</p>
          <p className="mt-1 text-3xl font-bold">{builders}</p>
        </div>
      </div>
      <p className="text-sm text-slate-500">The verification queue arrives in the next release.</p>
    </div>
  );
}
