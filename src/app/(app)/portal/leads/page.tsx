import Link from "next/link";
import { Download, Inbox, Phone, Search } from "lucide-react";
import { LeadStatusBadge } from "@/components/leads/status-badge";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/leads/format";
import { LEADS_PAGE_SIZE, leadSummary, listLeads } from "@/lib/leads/service";
import { LEAD_STATUSES, leadStatusLabel, parseLeadStatus } from "@/lib/leads/status";

export const metadata = { title: "Leads" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LeadsPage({ searchParams }: PageProps<"/portal/leads">) {
  const ctx = await requireBuilderContext("/portal/leads");
  const raw = await searchParams;
  const status = parseLeadStatus(first(raw.status));
  const q = (first(raw.q) ?? "").slice(0, 80);
  const due = first(raw.due) === "1";
  const page = Math.max(1, Number(first(raw.page)) || 1);
  const projectParam = first(raw.project) ?? "";

  const db = getDb();
  const projects = await db.project.findMany({
    where: { builderId: ctx.builder.id, status: { not: "ARCHIVED" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  // Only a project of this company can be a filter; anything else is ignored.
  const projectId = projects.find((p) => p.id === projectParam)?.id ?? null;

  const filters = { status, q, due, projectId, page };
  const [{ rows, total, counts, pages }, summary] = await Promise.all([
    listLeads(db, ctx.builder.id, filters),
    leadSummary(db, ctx.builder.id),
  ]);

  const link = (change: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | null> = {
      status,
      q: q || null,
      due: due ? "1" : null,
      project: projectId,
      page: null,
      ...change,
    };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const query = params.toString();
    return `/portal/leads${query ? `?${query}` : ""}`;
  };
  const exportHref = `/api/builder/leads/export?${new URLSearchParams(
    Object.entries({ status, q: q || null, due: due ? "1" : null, project: projectId }).filter(
      (entry): entry is [string, string] => Boolean(entry[1]),
    ),
  ).toString()}`;
  const everyone = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtered = Boolean(status || q || due || projectId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="mt-1 text-sm text-slate-600">
            Enquiries from buyers. Call or WhatsApp them, then move each one along as it progresses.
          </p>
        </div>
        {everyone > 0 && ctx.entitlements.leads === "full" && (
          <a href={exportHref} className={buttonClass("secondary")} data-testid="export-csv">
            <Download className="size-4" aria-hidden="true" /> Export CSV
          </a>
        )}
      </div>

      {everyone > 0 && ctx.entitlements.leads !== "full" && (
        <UpgradeNotice
          feature="Follow-up reminders, site-visit tracking and CSV export"
          plan="GROWTH"
          lapsed={!ctx.entitlements.active}
        />
      )}

      {everyone === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Inbox className="mx-auto size-10 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">No enquiries yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            When a buyer sends an enquiry about one of your live projects it appears here, and we
            email you straight away.
          </p>
          <Link href="/portal/projects" className={`${buttonClass("primary")} mt-5`}>
            My projects
          </Link>
        </div>
      ) : (
        <>
          <nav aria-label="Filter by status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex gap-2 whitespace-nowrap">
              <li>
                <Link
                  href={link({ status: null })}
                  aria-current={!status ? "true" : undefined}
                  className={`inline-block rounded-full border px-4 py-2 text-sm font-semibold ${!status ? "border-navy-900 bg-navy-900 text-white" : "hover:bg-surface border-slate-300 bg-white"}`}
                >
                  All ({everyone})
                </Link>
              </li>
              {LEAD_STATUSES.map((s) => (
                <li key={s}>
                  <Link
                    href={link({ status: s })}
                    aria-current={status === s ? "true" : undefined}
                    className={`inline-block rounded-full border px-4 py-2 text-sm font-semibold ${status === s ? "border-navy-900 bg-navy-900 text-white" : "hover:bg-surface border-slate-300 bg-white"}`}
                  >
                    {leadStatusLabel[s]} ({counts[s]})
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <form action="/portal/leads" method="get" className="flex flex-wrap items-end gap-3">
            {status && <input type="hidden" name="status" value={status} />}
            <label className="min-w-0 flex-1 basis-56">
              <span className="sr-only">Search leads</span>
              <span className="relative block">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  maxLength={80}
                  placeholder="Name, mobile, email or project"
                  className={`${inputClass} pl-9`}
                />
              </span>
            </label>
            <label>
              <span className="sr-only">Project</span>
              <select name="project" defaultValue={projectId ?? ""} className={inputClass}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="due"
                value="1"
                defaultChecked={due}
                className="size-5 accent-teal-700"
              />
              Follow-up due
              {summary.followUpsDue > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {summary.followUpsDue}
                </span>
              )}
            </label>
            <button type="submit" className={buttonClass("primary")}>
              Filter
            </button>
            {filtered && (
              <Link href="/portal/leads" className="text-sm font-semibold text-teal-700 underline">
                Clear
              </Link>
            )}
          </form>

          <p className="text-sm font-semibold" data-testid="lead-count" aria-live="polite">
            {total === 0
              ? "No leads match"
              : `${total} ${total === 1 ? "lead" : "leads"}${total > LEADS_PAGE_SIZE ? ` (page ${page} of ${pages})` : ""}`}
          </p>

          <ul className="space-y-3" data-testid="lead-list">
            {rows.map((lead) => (
              <li
                key={lead.id}
                data-testid="lead-row"
                data-lead-id={lead.id}
                className={`relative rounded-2xl border bg-white p-4 sm:p-5 ${lead.seenAt ? "border-slate-200" : "border-amber-500/60"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">
                      <Link
                        href={`/portal/leads/${lead.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
                      >
                        {lead.name}
                      </Link>
                      {!lead.seenAt && (
                        <span className="text-navy-900 ml-2 rounded-full bg-amber-500 px-2 py-0.5 align-middle text-xs font-bold">
                          Unread
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-slate-600">
                      {lead.project.name}
                      {lead.preferredPlot ? ` · Plot ${lead.preferredPlot}` : ""}
                    </p>
                  </div>
                  <LeadStatusBadge status={lead.status} />
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Phone className="size-4 text-slate-500" aria-hidden="true" />
                    <dt className="sr-only">Mobile</dt>
                    <dd className="font-medium">{lead.mobile}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-slate-600">Last message</dt>
                    <dd className="font-medium">{formatDateTime(lead.lastBuyerMessageAt)}</dd>
                  </div>
                  {lead.followUpAt && (
                    <div className="flex gap-1.5">
                      <dt className="text-slate-600">Follow up</dt>
                      <dd className="font-medium">{formatDate(lead.followUpAt)}</dd>
                    </div>
                  )}
                  {lead.source === "booking_request" && (
                    <div
                      className="font-semibold text-amber-800"
                      data-testid="booking-request-badge"
                    >
                      Wants to book a plot
                    </div>
                  )}
                  {lead.source === "online_booking" && (
                    <div className="font-semibold text-teal-800">Booked online</div>
                  )}
                  {lead.visits.length > 0 && (
                    <div className="font-semibold text-teal-800">Site visit asked for</div>
                  )}
                </dl>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-center gap-3">
              {page > 1 && (
                <Link href={link({ page: String(page - 1) })} className={buttonClass("secondary")}>
                  Previous
                </Link>
              )}
              <span className="text-sm text-slate-600">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <Link href={link({ page: String(page + 1) })} className={buttonClass("secondary")}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
