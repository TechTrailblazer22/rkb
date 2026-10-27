"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/format";
import type { LayoutMapData } from "@/lib/layout-map/service";

const STYLE: Record<string, { box: string; label: string }> = {
  AVAILABLE: { box: "border-teal-700 bg-teal-500/40 hover:bg-teal-500/60", label: "Available" },
  BOOKED: { box: "border-amber-600 bg-amber-400/45 hover:bg-amber-400/60", label: "Booked" },
  SOLD: { box: "border-slate-600 bg-slate-500/45 hover:bg-slate-500/60", label: "Sold" },
};

/**
 * The layout map buyers see: each plot coloured by its status, each one tappable (or reachable with
 * the keyboard) to show its details. The plot table on the page lists the same plots, so nothing
 * depends on the map alone.
 */
export function LayoutMapView({ map, projectName }: { map: LayoutMapData; projectName: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = map.shapes.find((s) => s.plot.id === selected)?.plot ?? null;

  return (
    <div data-testid="layout-map">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-slate-300 bg-white"
        style={
          map.imageUrl
            ? undefined
            : {
                aspectRatio: "16 / 10",
                backgroundImage:
                  "linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
                backgroundSize: "5% 5%",
              }
        }
        role="group"
        aria-label={`Layout map of ${projectName}`}
      >
        {map.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the builder's layout plan, sized by CSS
          <img src={map.imageUrl} alt="" loading="lazy" className="block h-auto w-full" />
        )}
        {map.shapes.map((shape) => {
          const style = STYLE[shape.plot.status] ?? STYLE.AVAILABLE;
          return (
            <button
              key={shape.plot.id}
              type="button"
              data-testid="map-plot"
              data-plot={shape.plot.number}
              data-status={shape.plot.status}
              aria-pressed={selected === shape.plot.id}
              aria-label={`Plot ${shape.plot.number}, ${shape.plot.sizeSqft.toLocaleString("en-IN")} square feet, ${style.label}`}
              onClick={() => setSelected(selected === shape.plot.id ? null : shape.plot.id)}
              className={`focus-visible:ring-navy-900 absolute flex items-center justify-center overflow-hidden border-2 text-[10px] font-bold text-slate-900 focus-visible:ring-2 focus-visible:outline-none sm:text-xs ${style.box} ${selected === shape.plot.id ? "ring-navy-900 ring-2" : ""}`}
              style={{
                left: `${shape.x}%`,
                top: `${shape.y}%`,
                width: `${shape.w}%`,
                height: `${shape.h}%`,
              }}
            >
              <span className="truncate px-0.5">{shape.plot.number}</span>
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700" aria-label="Colour key">
        {Object.entries(STYLE).map(([status, s]) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              className={`inline-block size-3.5 rounded-sm border-2 ${s.box.split("hover")[0]}`}
              aria-hidden="true"
            />
            {s.label}
          </li>
        ))}
      </ul>

      <div
        className="mt-3 min-h-14 rounded-xl bg-slate-50 p-4 text-sm"
        aria-live="polite"
        data-testid="map-details"
      >
        {chosen ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Plot</dt>
              <dd className="font-bold">{chosen.number}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Size</dt>
              <dd className="font-bold">{chosen.sizeSqft.toLocaleString("en-IN")} sq ft</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Price</dt>
              <dd className="font-bold">
                {chosen.price ? formatRupees(chosen.price) : "On request"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Status</dt>
              <dd className="font-bold">
                {STYLE[chosen.status]?.label}
                {chosen.isCorner ? ", corner plot" : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-slate-600">Tap a plot to see its details.</p>
        )}
      </div>
    </div>
  );
}
