export function ProgressRing({
  percent,
  size = 96,
  label = "complete",
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const stroke = Math.max(6, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Application ${clamped}% ${label}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={clamped === 100 ? "stroke-teal-500" : "stroke-amber-500"}
        />
      </svg>
      <span
        className="text-navy-900 absolute inset-0 flex items-center justify-center font-extrabold"
        style={{ fontSize: size / 4 }}
      >
        {clamped}%
      </span>
    </div>
  );
}
