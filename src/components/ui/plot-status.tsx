export type PlotStatus = "AVAILABLE" | "BOOKED" | "SOLD";

// One place defines the status colours used by chips, grids, maps and legends everywhere.
export const plotStatusStyle: Record<PlotStatus, { label: string; swatch: string }> = {
  AVAILABLE: { label: "Available", swatch: "bg-teal-500" },
  BOOKED: { label: "Booked", swatch: "bg-amber-500" },
  SOLD: { label: "Sold", swatch: "bg-slate-plot" },
};

export function PlotStatusChip({ status }: { status: PlotStatus }) {
  const style = plotStatusStyle[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
      <span className={`size-2.5 rounded-sm ${style.swatch}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}

export function PlotLegend({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <ul
      className={`flex flex-wrap gap-x-5 gap-y-1 ${tone === "dark" ? "text-white/80" : "text-slate-600"}`}
    >
      {(Object.keys(plotStatusStyle) as PlotStatus[]).map((status) => (
        <li key={status}>
          <PlotStatusChip status={status} />
        </li>
      ))}
    </ul>
  );
}
