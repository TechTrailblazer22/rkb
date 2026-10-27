import { Download } from "lucide-react";
import { AnalyticsChart } from "@/components/portal/analytics-chart";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { buttonClass } from "@/components/ui/button";
import { statsForBuilder } from "@/lib/analytics/stats";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";

export const metadata = { title: "Analytics" };

const pct = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : "n/a";

export default async function AnalyticsPage() {
  const ctx = await requireBuilderContext("/portal/analytics");
  const e = ctx.entitlements;

  if (e.analytics === "none") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Analytics</h2>
        <p className="text-sm text-slate-600">
          See how many people look at your projects, where they come from, and how many enquire.
        </p>
        <UpgradeNotice feature="Analytics" plan="GROWTH" lapsed={!e.active} />
      </div>
    );
  }

  const stats = await statsForBuilder(getDb(), ctx.builder.id);
  const { totals, funnel } = stats;
  const tiles: [string, number, string][] = [
    ["Page views", totals.VIEW, "visits to your project pages"],
    ["Enquiries", totals.ENQUIRY, `${pct(totals.ENQUIRY, totals.VIEW)} of views`],
    ["Calls and WhatsApp", totals.CALL + totals.WHATSAPP, "taps on the contact buttons"],
    ["Saved", totals.SHORTLIST, "times a project was saved"],
  ];
  const widest = Math.max(1, funnel.views);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Analytics</h2>
          <p className="mt-1 text-sm text-slate-600">
            The last {stats.days} days. Counts only: no visitor is identified. A visit is counted
            once per browser session, and search-engine crawlers are left out.
          </p>
        </div>
        {e.analytics === "export" ? (
          <a
            href="/api/builder/analytics/export"
            className={buttonClass("secondary")}
            data-testid="export-analytics"
          >
            <Download className="size-4" aria-hidden="true" /> Export CSV
          </a>
        ) : (
          <p className="text-xs text-slate-500">CSV export is part of the Premier plan.</p>
        )}
      </div>

      <section className="grid gap-4 sm:grid-cols-4" data-testid="analytics-tiles">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-2xl font-extrabold">{value.toLocaleString("en-IN")}</p>
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="text-base font-bold">Views and enquiries by day</h3>
        <div className="mt-3">
          <AnalyticsChart daily={stats.daily} />
        </div>
      </section>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="funnel"
      >
        <h3 className="text-base font-bold">From a look to a booking</h3>
        <ol className="mt-3 space-y-3">
          {(
            [
              ["Viewed a project", funnel.views],
              ["Sent an enquiry", funnel.enquiries],
              ["Asked for a site visit", funnel.visits],
              ["Booked", funnel.booked],
            ] as [string, number][]
          ).map(([label, value]) => (
            <li key={label}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-semibold">{label}</span>
                <span>{value.toLocaleString("en-IN")}</span>
              </div>
              <div
                className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-teal-600"
                  style={{
                    width: `${Math.max(value > 0 ? 2 : 0, Math.round((value / widest) * 100))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Booked counts enquiries that you marked Booked in this period.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h3 className="text-base font-bold">Where views come from</h3>
          {stats.sources.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No views yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="sources">
              {stats.sources.map((s) => (
                <li key={s.source} className="flex justify-between gap-2 py-2">
                  <span>{s.label}</span>
                  <span className="font-semibold">
                    {s.views.toLocaleString("en-IN")} ({pct(s.views, totals.VIEW)})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h3 className="text-base font-bold">By project</h3>
          {stats.perProject.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">You have no projects yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left text-sm" data-testid="by-project">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th scope="col" className="py-1.5 pr-3">
                      Project
                    </th>
                    <th scope="col" className="px-2 py-1.5">
                      Views
                    </th>
                    <th scope="col" className="px-2 py-1.5">
                      Calls
                    </th>
                    <th scope="col" className="px-2 py-1.5">
                      Saved
                    </th>
                    <th scope="col" className="px-2 py-1.5">
                      Enquiries
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.perProject.map((p) => (
                    <tr key={p.projectId} className="border-b border-slate-100">
                      <th scope="row" className="py-1.5 pr-3 font-medium">
                        {p.name}
                      </th>
                      <td className="px-2 py-1.5">{p.totals.VIEW}</td>
                      <td className="px-2 py-1.5">{p.totals.CALL + p.totals.WHATSAPP}</td>
                      <td className="px-2 py-1.5">{p.totals.SHORTLIST}</td>
                      <td className="px-2 py-1.5">{p.totals.ENQUIRY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
