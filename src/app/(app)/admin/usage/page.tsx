import { AdminNav } from "@/components/admin/admin-nav";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { usageSummary } from "@/lib/usage/activity";
import { PAGE_LABELS, SOURCE_LABELS } from "@/lib/usage/site-kinds";
import { siteVisitSummary } from "@/lib/usage/site-visits";

export const metadata = { title: "Usage" };

const label = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default async function AdminUsagePage() {
  await requireUser({ returnTo: "/admin/usage", roles: ["ADMIN"] });
  const [usage, site] = await Promise.all([usageSummary(getDb()), siteVisitSummary(getDb())]);
  const { registered, active } = usage;

  const periods: [string, keyof typeof active][] = [
    ["Today", "today"],
    ["Last 7 days", "last7"],
    ["Last 30 days", "last30"],
  ];
  const max = Math.max(1, ...usage.daily.flatMap((d) => [d.buyer, d.builder]));
  const width = 640;
  const height = 170;
  const pad = { top: 10, right: 8, bottom: 22, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = innerW / usage.daily.length;
  const bar = Math.max(2, (step * 0.8) / 2);
  const y = (n: number) => pad.top + innerH - (n / max) * innerH;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin console</h1>
      <AdminNav current="usage" />

      <p className="text-sm text-slate-600">
        The first section counts anonymous visits (anyone, logged in or not). The sections after it
        count different logged-in people, through their buyer account and through their builder
        account: a person is counted once a day per account, so someone who switches between the two
        counts in both. A builder&apos;s own analytics show the views of each of their projects.
      </p>

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="site-visits"
      >
        <h2 className="text-lg font-bold">Visits to the site, logged in or not</h2>
        <p className="mt-1 text-sm text-slate-600">
          Anonymous counts of visits, where one visit is one browser session (a person coming back
          another day counts again). Nothing identifies anyone: only the kind of page and where the
          visit came from are counted. Crawlers, the admin console, and browsers that ask not to be
          tracked are left out.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["Today", site.visits.today, "today"],
              ["Last 7 days", site.visits.last7, "last7"],
              ["Last 30 days", site.visits.last30, "last30"],
            ] as const
          ).map(([name, value, key]) => (
            <div key={key} className="rounded-xl bg-slate-50 p-4" data-visits={key}>
              <dt className="text-sm text-slate-600">{name}</dt>
              <dd className="text-2xl font-extrabold" data-cell="visits">
                {value.toLocaleString("en-IN")}
              </dd>
            </div>
          ))}
        </dl>
        {site.visits.last30 === 0 ? (
          <p className="mt-4 text-sm text-slate-600" data-testid="no-visits">
            No visits have been counted yet. They start appearing as people open the site.
          </p>
        ) : (
          <div className="mt-5 grid gap-6 lg:grid-cols-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Where visits came from (30 days)</h3>
              <ul className="mt-2 divide-y divide-slate-100 text-sm" data-testid="visit-sources">
                {site.bySource.map((s) => (
                  <li key={s.source} className="flex justify-between gap-3 py-1.5">
                    <span>{SOURCE_LABELS[s.source]}</span>
                    <span className="font-semibold">{s.visits.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">The page a visit started on (30 days)</h3>
              <ul
                className="mt-2 divide-y divide-slate-100 text-sm"
                data-testid="visit-entry-pages"
              >
                {site.entryPages.map((p) => (
                  <li key={p.page} className="flex justify-between gap-3 py-1.5">
                    <span>{PAGE_LABELS[p.page]}</span>
                    <span className="font-semibold">{p.visits.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Visits that reached each kind of page (30 days)</h3>
              <ul className="mt-2 divide-y divide-slate-100 text-sm" data-testid="visit-reached">
                {site.reached.map((p) => (
                  <li key={p.page} className="flex justify-between gap-3 py-1.5">
                    <span>{PAGE_LABELS[p.page]}</span>
                    <span className="font-semibold">{p.sessions.toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3" data-testid="registered">
        {[
          ["Buyer accounts", registered.buyerAccounts, "everyone with a login, except staff"],
          ["Builder accounts", registered.builderAccounts, "owners and team members of a company"],
          ["Staff", registered.staff, "admin logins"],
        ].map(([name, value, note]) => (
          <div key={name as string} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-2xl font-extrabold">{(value as number).toLocaleString("en-IN")}</p>
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">People who used the site</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm" data-testid="active-table">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th scope="col" className="py-2 pr-3">
                  Period
                </th>
                <th scope="col" className="px-3 py-2">
                  Through a buyer account
                </th>
                <th scope="col" className="px-3 py-2">
                  Through a builder account
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map(([name, key]) => (
                <tr key={key} className="border-b border-slate-100" data-period={key}>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {name}
                  </th>
                  <td className="px-3 py-2 font-semibold" data-cell="buyer">
                    {active[key].buyer.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 font-semibold" data-cell="builder">
                    {active[key].builder.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-600" data-testid="used-both">
          {usage.usedBoth30.toLocaleString("en-IN")} {usage.usedBoth30 === 1 ? "person" : "people"}{" "}
          used both a buyer and a builder account in the last 30 days.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Day by day, last 30 days</h2>
        <figure className="mt-3" data-testid="usage-chart">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="People using the site each day, through buyer accounts and through builder accounts"
            className="h-auto w-full"
          >
            {[0, Math.round(max / 2), max].map((tick) => (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="currentColor"
                  className="text-slate-200"
                />
                <text
                  x={pad.left - 6}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px]"
                >
                  {tick}
                </text>
              </g>
            ))}
            {usage.daily.map((d, i) => {
              const x = pad.left + i * step + (step - bar * 2) / 2;
              return (
                <g key={d.day}>
                  <rect
                    x={x}
                    y={y(d.buyer)}
                    width={bar}
                    height={Math.max(0, pad.top + innerH - y(d.buyer))}
                    className="fill-teal-600"
                  >
                    <title>{`${label(d.day)}: ${d.buyer} through buyer accounts`}</title>
                  </rect>
                  <rect
                    x={x + bar}
                    y={y(d.builder)}
                    width={bar}
                    height={Math.max(0, pad.top + innerH - y(d.builder))}
                    className="fill-amber-500"
                  >
                    <title>{`${label(d.day)}: ${d.builder} through builder accounts`}</title>
                  </rect>
                </g>
              );
            })}
            <text x={pad.left} y={height - 6} className="fill-slate-500 text-[10px]">
              {label(usage.daily[0].day)}
            </text>
            <text
              x={width - pad.right}
              y={height - 6}
              textAnchor="end"
              className="fill-slate-500 text-[10px]"
            >
              {label(usage.daily.at(-1)!.day)}
            </text>
          </svg>
          <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-teal-600" aria-hidden="true" />{" "}
              Buyer accounts
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-amber-500" aria-hidden="true" />{" "}
              Builder accounts
            </span>
          </figcaption>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-teal-800">
              Show the numbers as a table
            </summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th scope="col" className="py-1 pr-3">
                      Day
                    </th>
                    <th scope="col" className="px-3 py-1">
                      Buyer accounts
                    </th>
                    <th scope="col" className="px-3 py-1">
                      Builder accounts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usage.daily.map((d) => (
                    <tr key={d.day} className="border-b border-slate-100">
                      <th scope="row" className="py-1 pr-3 font-normal">
                        {label(d.day)}
                      </th>
                      <td className="px-3 py-1">{d.buyer}</td>
                      <td className="px-3 py-1">{d.builder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      </section>

      <p className="text-xs text-slate-500">
        Counting started when this page was added, so earlier days show zero. Logged-in people are
        stored as one row per day per account, and visits as plain counters: no page, address or
        device is kept.
      </p>
    </div>
  );
}
