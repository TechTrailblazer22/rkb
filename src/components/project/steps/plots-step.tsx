import Link from "next/link";
import { Search } from "lucide-react";
import { ConfirmSubmit } from "@/components/project/confirm-submit";
import { PlotImport } from "@/components/project/plot-import";
import { PlotStatusSelect } from "@/components/project/plot-status-select";
import { FACING_OPTIONS, PlotFields } from "@/components/project/steps/plot-fields";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { getDb } from "@/lib/db";
import { formatRupees } from "@/lib/format";
import { MAX_PLOTS_PER_PROJECT } from "@/lib/plots/import";
import { plotCountsByStatus } from "@/lib/plots/service";
import type { ProjectContext } from "@/lib/projects/context";
import type { PlotStatus } from "@/generated/prisma/enums";
import { MAX_SERIES } from "@/lib/plots/series";
import {
  addPlotAction,
  bulkPlotsAction,
  generateSeriesAction,
  updatePlotAction,
} from "@/app/(app)/portal/projects/actions";

const PAGE_SIZE = 50;
const STATUSES: PlotStatus[] = ["AVAILABLE", "BOOKED", "SOLD", "HELD"];
const facingLabel = (value: string | null) =>
  FACING_OPTIONS.find((o) => o.value === value)?.label ?? "";

type Query = Record<string, string | string[] | undefined>;
const one = (query: Query, key: string) =>
  typeof query[key] === "string" ? (query[key] as string) : "";

export async function PlotsStep({ ctx, query }: { ctx: ProjectContext; query: Query }) {
  const { project, projectMode } = ctx;
  const db = getDb();
  const editable = projectMode !== "locked";

  const status = STATUSES.find((s) => s === one(query, "status"));
  const search = one(query, "q").trim().slice(0, 30);
  const page = Math.max(1, Number.parseInt(one(query, "page"), 10) || 1);
  const where = {
    projectId: project.id,
    ...(status ? { status } : {}),
    ...(search ? { number: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [plots, matching, counts, editing] = await Promise.all([
    db.plot.findMany({
      where,
      orderBy: { sortKey: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.plot.count({ where }),
    plotCountsByStatus(db, project.id),
    one(query, "edit")
      ? db.plot.findFirst({ where: { id: one(query, "edit"), projectId: project.id } })
      : null,
  ]);
  const pages = Math.max(1, Math.ceil(matching / PAGE_SIZE));

  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { status: status ?? "", q: search, ...extra };
    for (const [key, value] of Object.entries(merged))
      if (value !== undefined && value !== "") params.set(key, String(value));
    const text = params.toString();
    return `/portal/projects/${project.id}/plots${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-bold">Plots and units</h3>
        <p className="mt-1 text-sm text-slate-600">
          Add them one by one, create a numbered series, or import a spreadsheet. Plot status
          changes are recorded with who made them and when.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="plot-counts">
          {[
            ["Total", counts.total, "text-navy-900"],
            ["Available", counts.AVAILABLE, "text-teal-700"],
            ["Booked", counts.BOOKED, "text-amber-700"],
            ["Sold", counts.SOLD, "text-slate-700"],
            ["Planned", project.totalPlots ?? "—", "text-slate-500"],
          ].map(([label, value, tone]) => (
            <div key={label as string} className="bg-surface rounded-xl px-4 py-3">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className={`text-2xl font-extrabold ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>
        {project.totalPlots !== null && counts.total > project.totalPlots && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            You have {counts.total} plots but the project total says {project.totalPlots}. Raise the
            total in the Size and layout step.
          </p>
        )}
      </section>

      {editable && (
        <section className="space-y-3">
          <details
            className="rounded-2xl border border-slate-200 bg-white p-5"
            open={counts.total === 0 || Boolean(editing)}
          >
            <summary className="cursor-pointer font-bold">Add a plot</summary>
            <form action={addPlotAction} className="mt-4 space-y-4" data-form="add-plot">
              <input type="hidden" name="projectId" value={project.id} />
              <PlotFields prefix="add" />
              <button type="submit" className={buttonClass("primary")}>
                Add plot
              </button>
            </form>
          </details>

          <details className="rounded-2xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer font-bold">Create a numbered series</summary>
            <form action={generateSeriesAction} className="mt-4 space-y-4" data-form="series">
              <p className="text-sm text-slate-600">
                For example plots A-1 to A-120, all 1,200 sq ft. You can edit single plots
                afterwards. Up to {MAX_SERIES} at a time.
              </p>
              <input type="hidden" name="projectId" value={project.id} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="series-prefix" label="Prefix" hint="Optional, such as A-">
                  <input
                    id="series-prefix"
                    name="prefix"
                    maxLength={10}
                    className={inputClass}
                    placeholder="A-"
                  />
                </Field>
                <Field id="series-start" label="From number" required>
                  <input
                    id="series-start"
                    name="start"
                    required
                    inputMode="numeric"
                    className={inputClass}
                    placeholder="1"
                  />
                </Field>
                <Field id="series-end" label="To number" required>
                  <input
                    id="series-end"
                    name="end"
                    required
                    inputMode="numeric"
                    className={inputClass}
                    placeholder="120"
                  />
                </Field>
                <Field id="series-pad" label="Pad to digits" hint="3 makes 007">
                  <input
                    id="series-pad"
                    name="padTo"
                    inputMode="numeric"
                    defaultValue="0"
                    className={inputClass}
                  />
                </Field>
                <Field id="series-size" label="Size (sq ft)" required>
                  <input
                    id="series-size"
                    name="sizeSqft"
                    required
                    inputMode="numeric"
                    className={inputClass}
                    placeholder="1200"
                  />
                </Field>
                <Field id="series-dim" label="Dimensions">
                  <input
                    id="series-dim"
                    name="dimensions"
                    className={inputClass}
                    placeholder="30x40"
                  />
                </Field>
                <Field id="series-facing" label="Facing">
                  <select id="series-facing" name="facing" className={inputClass}>
                    <option value="">Not set</option>
                    {FACING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="series-rate" label="Rate per sq ft (₹)">
                  <input
                    id="series-rate"
                    name="ratePerSqft"
                    inputMode="numeric"
                    className={inputClass}
                    placeholder="1850"
                  />
                </Field>
                <Field id="series-phase" label="Phase or block">
                  <input id="series-phase" name="phase" maxLength={40} className={inputClass} />
                </Field>
              </div>
              <button type="submit" className={buttonClass("primary")}>
                Create plots
              </button>
            </form>
          </details>

          <details
            className="rounded-2xl border border-slate-200 bg-white p-5"
            data-section="import"
          >
            <summary className="cursor-pointer font-bold">Import from Excel or CSV</summary>
            <div className="mt-4">
              <PlotImport projectId={project.id} />
            </div>
          </details>
        </section>
      )}

      {editing && editable && (
        <section
          className="rounded-2xl border-2 border-teal-500 bg-white p-6"
          data-form="edit-plot"
        >
          <h3 className="text-lg font-bold">Edit plot {editing.number}</h3>
          <form action={updatePlotAction} className="mt-4 space-y-4">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="plotId" value={editing.id} />
            <PlotFields
              prefix="edit"
              defaults={{
                ...editing,
                facing: editing.facing,
                status: editing.status === "HELD" ? "AVAILABLE" : editing.status,
              }}
            />
            <div className="flex gap-3">
              <button type="submit" className={buttonClass("primary")}>
                Save changes
              </button>
              <Link href={link({ edit: undefined })} className={buttonClass("secondary")}>
                Cancel
              </Link>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <form method="get" className="flex flex-wrap items-end gap-3" role="search">
          <Field id="filter-q" label="Find a plot number">
            <input
              id="filter-q"
              name="q"
              defaultValue={search}
              className={inputClass}
              placeholder="A-12"
            />
          </Field>
          <Field id="filter-status" label="Status">
            <select
              id="filter-status"
              name="status"
              defaultValue={status ?? ""}
              className={inputClass}
            >
              <option value="">All</option>
              <option value="AVAILABLE">Available</option>
              <option value="BOOKED">Booked</option>
              <option value="SOLD">Sold</option>
            </select>
          </Field>
          <button type="submit" className={buttonClass("secondary")}>
            <Search className="size-4" aria-hidden="true" />
            Filter
          </button>
          {(status || search) && (
            <Link
              href={`/portal/projects/${project.id}/plots`}
              className="pb-2.5 text-sm font-semibold text-teal-700 underline"
            >
              Clear filter
            </Link>
          )}
        </form>

        {plots.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
            {counts.total === 0
              ? "No plots yet. Add one above, create a series or import a file."
              : "No plots match this filter."}
          </p>
        ) : (
          <form action={bulkPlotsAction} className="mt-5 space-y-3" data-form="bulk">
            <input type="hidden" name="projectId" value={project.id} />
            {editable && (
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Actions for ticked plots"
              >
                <span className="text-sm text-slate-600">Ticked plots:</span>
                <button name="bulk" value="AVAILABLE" className={buttonClass("secondary")}>
                  Mark available
                </button>
                <button name="bulk" value="BOOKED" className={buttonClass("secondary")}>
                  Mark booked
                </button>
                <button name="bulk" value="SOLD" className={buttonClass("secondary")}>
                  Mark sold
                </button>
                <ConfirmSubmit
                  name="bulk"
                  value="DELETE"
                  message="Delete the ticked plots? Their history is kept, but the plots are removed from the project."
                  className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Delete
                </ConfirmSubmit>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">Plots of this project</caption>
                <thead className="bg-surface border-b border-slate-200 text-xs text-slate-600 uppercase">
                  <tr>
                    {editable && (
                      <th scope="col" className="w-10 px-3 py-3">
                        <span className="sr-only">Select</span>
                      </th>
                    )}
                    <th scope="col" className="px-3 py-3">
                      Plot
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Size
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Facing
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Rate
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Price
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Status
                    </th>
                    {editable && (
                      <th scope="col" className="px-3 py-3">
                        <span className="sr-only">Edit</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plots.map((plot) => (
                    <tr key={plot.id} data-plot-number={plot.number}>
                      {editable && (
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            name="plotId"
                            value={plot.id}
                            aria-label={`Select plot ${plot.number}`}
                            className="size-4 accent-teal-700"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2.5 font-semibold">
                        {plot.number}
                        {plot.isCorner && (
                          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                            Corner
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {plot.sizeSqft.toLocaleString("en-IN")} sq ft
                        {plot.dimensions && (
                          <span className="block text-xs text-slate-500">{plot.dimensions}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{facingLabel(plot.facing) || "—"}</td>
                      <td className="px-3 py-2.5">
                        {plot.ratePerSqft ? formatRupees(plot.ratePerSqft) : "—"}
                      </td>
                      <td className="px-3 py-2.5">{plot.price ? formatRupees(plot.price) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <PlotStatusSelect
                          projectId={project.id}
                          plotId={plot.id}
                          status={plot.status}
                          disabled={!editable}
                        />
                      </td>
                      {editable && (
                        <td className="px-3 py-2.5 text-right">
                          <Link
                            href={link({ edit: plot.id })}
                            className="font-semibold text-teal-700 underline"
                          >
                            Edit
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}

        {pages > 1 && (
          <nav aria-label="Plot pages" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              Page {page} of {pages} ({matching} plots)
            </span>
            {page > 1 && (
              <Link href={link({ page: page - 1 })} className={buttonClass("secondary")}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={link({ page: page + 1 })} className={buttonClass("secondary")}>
                Next
              </Link>
            )}
          </nav>
        )}
        <p className="mt-4 text-xs text-slate-500">
          A project can hold up to {MAX_PLOTS_PER_PROJECT.toLocaleString("en-IN")} plots.
        </p>
      </section>
    </div>
  );
}
