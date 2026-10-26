import { plotStatusStyle } from "@/components/ui/plot-status";

/**
 * How many plots are available, booked and sold, as one bar. The colours are the same ones used
 * for the status chips and the plot table (see plot-status.tsx). It draws only counts it is given:
 * with no plots it draws nothing, never an invented picture.
 */
export function AvailabilityBar({
  available,
  booked,
  sold,
  size = "sm",
  legend = false,
  className = "",
}: {
  available: number;
  booked: number;
  sold: number;
  size?: "sm" | "md";
  /** Spell out the three counts under the bar. */
  legend?: boolean;
  className?: string;
}) {
  const total = available + booked + sold;
  if (total === 0) return null;

  const parts = [
    { key: "AVAILABLE", count: available },
    { key: "BOOKED", count: booked },
    { key: "SOLD", count: sold },
  ] as const;
  const summary = `${available} available, ${booked} booked and ${sold} sold, out of ${total} plots`;

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={summary}
        className={`bg-surface flex overflow-hidden rounded-full ${size === "md" ? "h-3" : "h-2"}`}
      >
        {parts.map(({ key, count }) =>
          count > 0 ? (
            <span
              key={key}
              className={plotStatusStyle[key].swatch}
              style={{ width: `${(count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <ul
          className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700"
          aria-hidden="true"
        >
          {parts.map(({ key, count }) => (
            <li key={key} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${plotStatusStyle[key].swatch}`} />
              <span className="font-semibold">{count}</span> {plotStatusStyle[key].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
