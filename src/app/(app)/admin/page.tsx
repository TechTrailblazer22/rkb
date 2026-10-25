import Link from "next/link";
import { BuilderStatusBadge } from "@/components/portal/status-badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import type { BuilderStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Admin" };

const ORDER: BuilderStatus[] = [
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "VERIFIED",
  "DRAFT",
  "REJECTED",
  "SUSPENDED",
];

export default async function AdminPage() {
  await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });

  const db = getDb();
  const [users, grouped] = await Promise.all([
    db.user.count(),
    db.builder.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  const waiting = counts.get("SUBMITTED") ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/40 bg-amber-50 p-6">
        <div>
          <p className="text-3xl font-extrabold">{waiting}</p>
          <p className="text-sm text-slate-700">
            {waiting === 1 ? "application is" : "applications are"} waiting for verification
          </p>
        </div>
        <Link href="/admin/builders?status=SUBMITTED" className={buttonClass("primary", "lg")}>
          Open the queue
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Users</p>
          <p className="mt-1 text-3xl font-bold">{users}</p>
        </div>
        {ORDER.map((status) => (
          <Link
            key={status}
            href={`/admin/builders?status=${status}`}
            className="rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-500"
          >
            <BuilderStatusBadge status={status} />
            <p className="mt-2 text-3xl font-bold">{counts.get(status) ?? 0}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
