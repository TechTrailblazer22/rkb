import { parsePlotRow, type PlotInput } from "@/lib/plots/row";

export const MAX_SERIES = 500;

export type SeriesInput = {
  prefix: string;
  start: number;
  end: number;
  /** Zero-pad numbers to this many digits: 3 turns 7 into "007". 0 means no padding. */
  padTo: number;
  sizeSqft: unknown;
  dimensions?: unknown;
  facing?: unknown;
  roadWidthFt?: unknown;
  ratePerSqft?: unknown;
  phase?: unknown;
};

export type SeriesResult = { ok: true; plots: PlotInput[] } | { ok: false; error: string };

/**
 * "Plots A-1 to A-120, all 1200 sq ft at ₹1,850 per sq ft": builds the whole run in one go, so
 * a builder does not type 120 rows. Individual plots can be edited afterwards.
 */
export function buildSeries(input: SeriesInput): SeriesResult {
  const prefix = input.prefix.trim();
  if (prefix.length > 10) return { ok: false, error: "The prefix can be at most 10 characters." };
  if (![input.start, input.end, input.padTo].every(Number.isInteger)) {
    return { ok: false, error: "Start, end and padding must be whole numbers." };
  }
  if (input.start < 0 || input.end < input.start) {
    return {
      ok: false,
      error: "The end number must be the same as or higher than the start number.",
    };
  }
  if (input.end > 999_999) return { ok: false, error: "The end number is too large." };
  if (input.padTo < 0 || input.padTo > 8)
    return { ok: false, error: "Padding must be between 0 and 8 digits." };
  const count = input.end - input.start + 1;
  if (count > MAX_SERIES) {
    return {
      ok: false,
      error: `Create at most ${MAX_SERIES} plots at a time (you asked for ${count}).`,
    };
  }

  const plots: PlotInput[] = [];
  for (let n = input.start; n <= input.end; n++) {
    const digits = input.padTo > 0 ? String(n).padStart(input.padTo, "0") : String(n);
    const parsed = parsePlotRow({
      number: `${prefix}${digits}`,
      sizeSqft: input.sizeSqft,
      dimensions: input.dimensions,
      facing: input.facing,
      roadWidthFt: input.roadWidthFt,
      ratePerSqft: input.ratePerSqft,
      phase: input.phase,
    });
    if (!parsed.ok) return { ok: false, error: parsed.errors[0] };
    plots.push(parsed.value);
  }
  return { ok: true, plots };
}
