import { plotStatusStyle, type PlotStatus } from "@/components/ui/plot-status";

// The cover-page layout from the proposal. A = available, B = booked, S = sold.
const COVER = ["BASAABAAABBB", "BAABAABBABAS", "AAASABBAAAAA", "ASAABSBASASA", "AABAAAAAAAAA"];

const CODE: Record<string, PlotStatus> = { A: "AVAILABLE", B: "BOOKED", S: "SOLD" };

// Available plots that slowly flip to "booked" and back, to suggest live inventory.
const LIVE = new Set(["0-1", "1-2", "2-4", "3-2", "4-3", "2-8", "1-10", "4-9"]);

/** Deterministic pseudo-random layout, so each sample project gets its own artwork. */
function seededRows(seed: number, cols: number, rows: number, availableRatio: number): string[] {
  let state = seed * 2654435761 + 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => {
      const roll = next();
      if (roll < availableRatio) return "A";
      return roll < availableRatio + (1 - availableRatio) * 0.55 ? "B" : "S";
    }).join(""),
  );
}

type Props = {
  className?: string;
  /** Animate a few cells. Respects prefers-reduced-motion. */
  live?: boolean;
  /** Without these, the proposal's cover layout is drawn. */
  seed?: number;
  availableRatio?: number;
  cols?: number;
  rows?: number;
};

export function PlotGridArt({
  className = "",
  live = false,
  seed,
  availableRatio = 0.6,
  cols = 12,
  rows = 5,
}: Props) {
  const grid =
    seed === undefined
      ? COVER
      : seededRows(seed, cols, rows, Math.min(Math.max(availableRatio, 0), 1));
  const columnCount = grid[0].length;

  return (
    <div
      role="img"
      aria-label="Illustration of a plotted layout with available, booked and sold plots"
      className={`grid gap-1.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {grid.flatMap((row, r) =>
        row.split("").map((code, c) => {
          const status = CODE[code];
          const isLive = live && status === "AVAILABLE" && LIVE.has(`${r}-${c}`);
          return (
            <span
              key={`${r}-${c}`}
              aria-hidden="true"
              className={`aspect-[4/3] rounded-[5px] ${plotStatusStyle[status].swatch} ${isLive ? "plot-cell-live" : ""}`}
              style={isLive ? { animationDelay: `${((r * 7 + c * 3) % 9) * 0.6}s` } : undefined}
            />
          );
        }),
      )}
    </div>
  );
}
