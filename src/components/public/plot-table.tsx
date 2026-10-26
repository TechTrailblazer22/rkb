"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PlotStatusChip } from "@/components/ui/plot-status";
import { formatRupees } from "@/lib/format";

export type PublicPlot = {
  id: string;
  number: string;
  sizeSqft: number;
  dimensions: string | null;
  facing: string | null;
  isCorner: boolean;
  price: number | null;
  /** HELD is shown to buyers as Booked. */
  status: "AVAILABLE" | "BOOKED" | "SOLD";
};

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "AVAILABLE", label: "Available" },
  { value: "BOOKED", label: "Booked" },
  { value: "SOLD", label: "Sold" },
] as const;
const PAGE = 50;

/** The project's plots, with status chips and a search box that work instantly in the browser. */
export function PlotTable({ plots, total }: { plots: PublicPlot[]; total: number }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("ALL");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    const result = { ALL: plots.length, AVAILABLE: 0, BOOKED: 0, SOLD: 0 };
    for (const plot of plots) result[plot.status]++;
    return result;
  }, [plots]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plots.filter(
      (plot) =>
        (filter === "ALL" || plot.status === filter) &&
        (!needle || plot.number.toLowerCase().includes(needle)),
    );
  }, [plots, filter, query]);

  return (
    <div data-testid="plot-table">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter plots by status" className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value);
                setShown(PAGE);
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                filter === option.value
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "hover:bg-surface border-slate-300 bg-white text-slate-700"
              }`}
            >
              {option.label} <span className="font-normal">({counts[option.value]})</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto block w-full sm:w-48">
          <span className="sr-only">Find a plot number</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
            placeholder="Find a plot"
            className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm focus:border-teal-700 focus:ring-2 focus:ring-teal-700/30 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Plot availability</caption>
          <thead className="bg-surface border-b border-slate-200 text-xs text-slate-600 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">
                Plot
              </th>
              <th scope="col" className="px-4 py-3">
                Size
              </th>
              <th scope="col" className="px-4 py-3">
                Facing
              </th>
              <th scope="col" className="px-4 py-3">
                Price
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, shown).map((plot) => (
              <tr key={plot.id} data-plot-number={plot.number} data-status={plot.status}>
                <td className="px-4 py-2.5 font-semibold">
                  {plot.number}
                  {plot.isCorner && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                      Corner
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {plot.sizeSqft.toLocaleString("en-IN")} sq ft
                  {plot.dimensions && (
                    <span className="block text-xs text-slate-500">{plot.dimensions}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">{plot.facing ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {plot.price ? formatRupees(plot.price) : "On request"}
                </td>
                <td className="px-4 py-2.5">
                  <PlotStatusChip status={plot.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-600">
                  No plots match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <span>
          Showing {Math.min(shown, rows.length)} of {rows.length}
        </span>
        {rows.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="font-semibold text-teal-700 underline"
          >
            Show more
          </button>
        )}
        {total > plots.length && (
          <span>
            The first {plots.length} of {total} plots are listed. Ask the builder about the rest.
          </span>
        )}
      </div>
    </div>
  );
}
