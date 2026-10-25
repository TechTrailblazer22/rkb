import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { can } from "@/lib/auth/roles";

export const metadata = { title: "Builder portal" };

export default async function PortalPage() {
  const user = await requireUser({
    returnTo: "/portal",
    roles: ["BUILDER_OWNER", "BUILDER_TEAM"],
  });

  // Scoped by membership, never by an id from the URL.
  const builder = await getDb().builder.findFirst({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, companyName: true, status: true },
  });
  if (!builder || !can(user, "builder:manage", { builderId: builder.id })) {
    return (
      <p className="text-sm text-slate-600">No builder account is linked to your login yet.</p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Builder portal</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">
            {builder.companyName ?? "Your company (name not set yet)"}
          </h2>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {builder.status}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Your builder account is created. Next you will add your company profile, upload your
          documents for verification, and list your projects. Those steps arrive in the next
          release.
        </p>
      </section>
    </div>
  );
}
