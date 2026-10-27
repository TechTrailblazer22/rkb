type Point = { day: string; views: number; enquiries: number };

/**
 * Daily views as bars, with enquiries marked above them. Drawn as plain SVG (no charting library),
 * with the same numbers in a table underneath for screen readers and for anyone who wants them.
 */
export function AnalyticsChart({ daily }: { daily: Point[] }) {
  const width = 640;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 22, left: 34 };
  const max = Math.max(5, ...daily.map((d) => Math.max(d.views, d.enquiries)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = innerW / Math.max(daily.length, 1);
  const barW = Math.max(2, step * 0.7);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  const ticks = [0, Math.round(max / 2), max];
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <figure data-testid="analytics-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Daily page views and enquiries for the last ${daily.length} days`}
        className="h-auto w-full"
      >
        {ticks.map((tick) => (
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
        {daily.map((d, i) => {
          const x = pad.left + i * step + (step - barW) / 2;
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={y(d.views)}
                width={barW}
                height={Math.max(0, pad.top + innerH - y(d.views))}
                rx={1.5}
                className="fill-teal-600"
              >
                <title>{`${label(d.day)}: ${d.views} views, ${d.enquiries} enquiries`}</title>
              </rect>
              {d.enquiries > 0 && (
                <circle
                  cx={x + barW / 2}
                  cy={y(d.enquiries)}
                  r={3.5}
                  className="fill-amber-500 stroke-white"
                >
                  <title>{`${label(d.day)}: ${d.enquiries} enquiries`}</title>
                </circle>
              )}
            </g>
          );
        })}
        <text x={pad.left} y={height - 6} className="fill-slate-500 text-[10px]">
          {daily[0] ? label(daily[0].day) : ""}
        </text>
        <text
          x={width - pad.right}
          y={height - 6}
          textAnchor="end"
          className="fill-slate-500 text-[10px]"
        >
          {daily.at(-1) ? label(daily.at(-1)!.day) : ""}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-teal-600" aria-hidden="true" /> Page
          views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full bg-amber-500" aria-hidden="true" />{" "}
          Enquiries
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
                  Views
                </th>
                <th scope="col" className="px-3 py-1">
                  Enquiries
                </th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.day} className="border-b border-slate-100">
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {label(d.day)}
                  </th>
                  <td className="px-3 py-1">{d.views}</td>
                  <td className="px-3 py-1">{d.enquiries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
