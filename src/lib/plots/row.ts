import type { PlotFacing } from "@/generated/prisma/enums";

/** One plot or unit as the builder describes it, after validation. */
export type PlotInput = {
  number: string;
  sizeSqft: number;
  dimensions: string | null;
  facing: PlotFacing | null;
  isCorner: boolean;
  roadWidthFt: number | null;
  ratePerSqft: number | null;
  price: number | null;
  /** Builders can set Available, Booked and Sold. "Held" is reserved for online booking. */
  status: "AVAILABLE" | "BOOKED" | "SOLD";
  phase: string | null;
  unitType: string | null;
  builtUpSqft: number | null;
};

export type RowResult = { ok: true; value: PlotInput } | { ok: false; errors: string[] };

export const MIN_PLOT_SIZE = 50;
export const MAX_PLOT_SIZE = 1_000_000;

const isEmpty = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/** Accepts 1200, "1,200", "₹ 1,20,000" and "1200.4". Returns null when it is not a number. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const FACINGS: Record<string, PlotFacing> = {
  N: "NORTH",
  NORTH: "NORTH",
  S: "SOUTH",
  SOUTH: "SOUTH",
  E: "EAST",
  EAST: "EAST",
  W: "WEST",
  WEST: "WEST",
  NE: "NORTH_EAST",
  NORTHEAST: "NORTH_EAST",
  NW: "NORTH_WEST",
  NORTHWEST: "NORTH_WEST",
  SE: "SOUTH_EAST",
  SOUTHEAST: "SOUTH_EAST",
  SW: "SOUTH_WEST",
  SOUTHWEST: "SOUTH_WEST",
};

export function parseFacing(value: unknown): PlotFacing | null | undefined {
  if (isEmpty(value)) return null;
  const key = String(value)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return FACINGS[key]; // undefined means "not recognised"
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (isEmpty(value)) return false;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  const text = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1", "corner"].includes(text)) return true;
  if (["no", "n", "false", "0"].includes(text)) return false;
  return undefined;
}

function parseStatus(value: unknown): PlotInput["status"] | undefined {
  if (isEmpty(value)) return "AVAILABLE";
  const text = String(value).trim().toLowerCase();
  if (["available", "avail", "a", "open"].includes(text)) return "AVAILABLE";
  if (["booked", "b", "reserved"].includes(text)) return "BOOKED";
  if (["sold", "s"].includes(text)) return "SOLD";
  return undefined;
}

const NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/;
const DIMENSIONS = /^\d+(\.\d+)?\s*[xX×]\s*\d+(\.\d+)?$/;

/**
 * Checks one row. `raw` uses these keys: number, sizeSqft, dimensions, facing, corner,
 * roadWidthFt, ratePerSqft, price, status, phase, unitType, builtUpSqft. Cell values may be
 * strings, numbers or booleans, since they come from CSV or Excel. All problems are reported,
 * not just the first, so the builder can fix a row in one go.
 */
export function parsePlotRow(raw: Record<string, unknown>): RowResult {
  const errors: string[] = [];

  const number = String(raw.number ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!number) errors.push("Plot number is missing.");
  else if (number.length > 20) errors.push("Plot number is longer than 20 characters.");
  else if (!NUMBER_PATTERN.test(number)) {
    errors.push("Plot number may only contain letters, digits, spaces and . / _ -");
  }

  const integer = (
    key: string,
    label: string,
    min: number,
    max: number,
    required: boolean,
  ): number | null => {
    const cell = raw[key];
    if (isEmpty(cell)) {
      if (required) errors.push(`${label} is missing.`);
      return null;
    }
    const value = toNumber(cell);
    if (value === null) {
      errors.push(`${label} must be a number.`);
      return null;
    }
    const rounded = Math.round(value);
    if (rounded < min || rounded > max) {
      errors.push(
        `${label} must be between ${min.toLocaleString("en-IN")} and ${max.toLocaleString("en-IN")}.`,
      );
      return null;
    }
    return rounded;
  };

  const sizeSqft = integer("sizeSqft", "Size (sq ft)", MIN_PLOT_SIZE, MAX_PLOT_SIZE, true);
  const roadWidthFt = integer("roadWidthFt", "Road width (ft)", 1, 500, false);
  const ratePerSqft = integer("ratePerSqft", "Rate per sq ft", 1, 10_000_000, false);
  let price = integer("price", "Price", 1, 10_000_000_000, false);
  const builtUpSqft = integer("builtUpSqft", "Built-up area (sq ft)", 1, 1_000_000, false);

  let dimensions: string | null = null;
  if (!isEmpty(raw.dimensions)) {
    const text = String(raw.dimensions).trim();
    if (!DIMENSIONS.test(text)) errors.push('Dimensions must look like "20x50".');
    else dimensions = text.replace(/\s+/g, "").replace(/[X×]/g, "x");
  }

  const facing = parseFacing(raw.facing);
  if (facing === undefined)
    errors.push("Facing is not recognised. Use East, West, North-East and so on.");

  const isCorner = parseBoolean(raw.corner);
  if (isCorner === undefined) errors.push("Corner must be yes or no.");

  const status = parseStatus(raw.status);
  if (status === undefined) errors.push("Status must be Available, Booked or Sold.");

  const text = (key: string, label: string, max: number): string | null => {
    if (isEmpty(raw[key])) return null;
    const value = String(raw[key]).trim();
    if (value.length > max) {
      errors.push(`${label} is longer than ${max} characters.`);
      return null;
    }
    return value;
  };
  const phase = text("phase", "Phase", 40);
  const unitType = text("unitType", "Unit type", 40);

  // A rate and a size are enough to work out the price.
  if (price === null && ratePerSqft !== null && sizeSqft !== null) price = ratePerSqft * sizeSqft;

  if (
    errors.length > 0 ||
    sizeSqft === null ||
    facing === undefined ||
    isCorner === undefined ||
    status === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      number,
      sizeSqft,
      dimensions,
      facing,
      isCorner,
      roadWidthFt,
      ratePerSqft,
      price,
      status,
      phase,
      unitType,
      builtUpSqft,
    },
  };
}
