import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { BuilderStatusBadge } from "@/components/portal/status-badge";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { statusLabel } from "@/lib/builders/status";
import type { BuilderStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Builders" };

const STATUSES = Object.keys(statusLabel) as BuilderStatus[];

export default async function AdminBuildersPage({ searchParams }: PageProps<"/admin/builders">) {
  await requireUser({ returnTo: "/admin/builders", roles: ["ADMIN"] });
  const { status: requested } = await searchParams;
  const status = STATUSES.find((s) => s === requested) ?? "SUBMITTED";

  const builders = await getDb().builder.findMany({
    where: { status },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      members: {
        where: { role: "OWNER" },
        include: { user: { select: { email: true, name: true } } },
      },
      _count: { select: { documents: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="builders" />
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="text-sm font-semibold text-teal-700 underline">
          Admin
        </Link>
        <span aria-hidden="true">/</span>
        <h2 className="text-xl font-bold">Builders</h2>
      </div>

      <nav aria-label="Filter by status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={`/admin/builders?status=${s}`}
                aria-current={s === status ? "page" : undefined}
                className={`inline-block rounded-full px-4 py-2 text-sm font-semibold ${
                  s === status
                    ? "bg-navy-900 text-white"
                    : "hover:bg-surface bg-white text-slate-700"
                } border border-slate-200`}
              >
                {statusLabel[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {builders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          Nothing here. No builders are {statusLabel[status].toLowerCase()} right now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Builders with status {statusLabel[status]}</caption>
            <thead className="bg-surface border-b border-slate-200 text-xs text-slate-600 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Company
                </th>
                <th scope="col" className="px-4 py-3">
                  Owner
                </th>
                <th scope="col" className="px-4 py-3">
                  Documents
                </th>
                <th scope="col" className="px-4 py-3">
                  Submitted
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {builders.map((builder) => {
                const owner = builder.members[0]?.user;
                return (
                  <tr key={builder.id} className="hover:bg-surface/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/builders/${builder.id}`}
                        className="font-semibold text-teal-700 underline"
                      >
                        {builder.companyName ?? "(no name yet)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p>{owner?.name ?? "—"}</p>
                      <p className="text-xs text-slate-500">{owner?.email}</p>
                    </td>
                    <td className="px-4 py-3">{builder._count.documents}</td>
                    <td className="px-4 py-3">
                      {builder.submittedAt ? formatDateTime(builder.submittedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <BuilderStatusBadge status={builder.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
