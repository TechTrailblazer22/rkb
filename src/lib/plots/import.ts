import { parsePlotRow, type PlotInput } from "@/lib/plots/row";

export const MAX_IMPORT_ROWS = 2000;
/** A project may hold at most this many plots in total. */
export const MAX_PLOTS_PER_PROJECT = 5000;

type ColumnKey =
  | "number"
  | "sizeSqft"
  | "dimensions"
  | "facing"
  | "corner"
  | "roadWidthFt"
  | "ratePerSqft"
  | "price"
  | "status"
  | "phase"
  | "unitType"
  | "builtUpSqft";

// `header` is what the downloadable template uses. Aliases let builders keep the headings
// they already have in their own sheets.
export const PLOT_COLUMNS: {
  key: ColumnKey;
  header: string;
  aliases: string[];
  required?: boolean;
}[] = [
  {
    key: "number",
    header: "plot_number",
    required: true,
    aliases: [
      "plot number",
      "plot no",
      "plot",
      "number",
      "unit",
      "unit number",
      "unit no",
      "sl no",
    ],
  },
  {
    key: "sizeSqft",
    header: "size_sqft",
    required: true,
    aliases: ["size", "size sqft", "area", "area sqft", "plot size", "sq ft", "sqft", "size sq ft"],
  },
  { key: "dimensions", header: "dimensions", aliases: ["dimension", "size ft", "dimensions ft"] },
  { key: "facing", header: "facing", aliases: ["direction"] },
  { key: "corner", header: "corner", aliases: ["corner plot", "is corner"] },
  { key: "roadWidthFt", header: "road_width_ft", aliases: ["road width", "road", "road width ft"] },
  {
    key: "ratePerSqft",
    header: "rate_per_sqft",
    aliases: ["rate", "price per sqft", "price per sq ft", "rate sqft", "rate per sq ft"],
  },
  { key: "price", header: "price", aliases: ["total price", "amount", "cost"] },
  { key: "status", header: "status", aliases: ["availability"] },
  { key: "phase", header: "phase", aliases: ["phase name", "block"] },
  { key: "unitType", header: "unit_type", aliases: ["type", "unit type", "bhk"] },
  {
    key: "builtUpSqft",
    header: "built_up_sqft",
    aliases: ["built up", "built up area", "builtup", "built up sqft"],
  },
];

/** "Plot No." and "plot_no" and "PLOT NO" all become "plot no". */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const headerToKey = new Map<string, ColumnKey>();
for (const column of PLOT_COLUMNS) {
  headerToKey.set(normalizeHeader(column.header), column.key);
  for (const alias of column.aliases) headerToKey.set(normalizeHeader(alias), column.key);
}

export type ImportRow = {
  /** Row number as shown in the spreadsheet, so the builder can find it. */
  line: number;
  number: string;
  errors: string[];
  value: PlotInput | null;
};

export type ImportPreview = {
  /** A problem with the file as a whole. When set, `rows` is empty. */
  fatal: string | null;
  ignoredColumns: string[];
  rows: ImportRow[];
  okCount: number;
  errorCount: number;
};

const empty = (fatal: string): ImportPreview => ({
  fatal,
  ignoredColumns: [],
  rows: [],
  okCount: 0,
  errorCount: 0,
});

const isBlankRow = (row: unknown[]) =>
  row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");

/**
 * Turns the cells of a spreadsheet into a row-by-row report: which rows are fine and which have
 * problems (and exactly what). Nothing is saved here.
 *
 * @param existingNumbers plot numbers already in the project, compared ignoring case
 */
export function previewPlotRows(
  table: unknown[][],
  existingNumbers: Iterable<string>,
): ImportPreview {
  const headerIndex = table.findIndex((row) => !isBlankRow(row));
  if (headerIndex === -1) return empty("The file is empty.");

  const columnOf = new Map<ColumnKey, number>();
  const ignored: string[] = [];
  table[headerIndex].forEach((cell, index) => {
    const name = String(cell ?? "").trim();
    if (!name) return;
    const key = headerToKey.get(normalizeHeader(name));
    if (key && !columnOf.has(key)) columnOf.set(key, index);
    else ignored.push(name);
  });

  const missing = PLOT_COLUMNS.filter((c) => c.required && !columnOf.has(c.key)).map(
    (c) => c.header,
  );
  if (missing.length > 0) {
    return empty(
      `The first row must have these column headings: ${missing.join(", ")}. Download the template to see the layout.`,
    );
  }

  const body = table
    .slice(headerIndex + 1)
    .map((cells, i) => ({ cells, line: headerIndex + i + 2 }));
  const dataRows = body.filter((row) => !isBlankRow(row.cells));
  if (dataRows.length === 0) return empty("The file has headings but no plots.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return empty(
      `The file has ${dataRows.length} rows. Please import at most ${MAX_IMPORT_ROWS} at a time.`,
    );
  }

  const taken = new Set([...existingNumbers].map((n) => n.trim().toLowerCase()));
  const seenInFile = new Map<string, number>();
  const rows: ImportRow[] = [];

  for (const { cells, line } of dataRows) {
    const raw: Record<string, unknown> = {};
    for (const [key, index] of columnOf) raw[key] = cells[index];

    const parsed = parsePlotRow(raw);
    const errors = parsed.ok ? [] : [...parsed.errors];
    const number = String(raw.number ?? "").trim();

    if (number) {
      const normalized = number.toLowerCase();
      if (taken.has(normalized)) errors.push(`Plot ${number} already exists in this project.`);
      const firstLine = seenInFile.get(normalized);
      if (firstLine !== undefined)
        errors.push(`Plot ${number} is repeated; it first appears on row ${firstLine}.`);
      else seenInFile.set(normalized, line);
    }

    rows.push({
      line,
      number,
      errors,
      value: errors.length === 0 && parsed.ok ? parsed.value : null,
    });
  }

  const okCount = rows.filter((r) => r.value).length;
  return { fatal: null, ignoredColumns: ignored, rows, okCount, errorCount: rows.length - okCount };
}

/** The file builders download, fill in, and upload. Opens directly in Excel. */
export function plotTemplateCsv(): string {
  const header = PLOT_COLUMNS.map((c) => c.header).join(",");
  const examples = [
    "A-1,1200,30x40,East,yes,30,1850,,Available,Phase 1,,",
    "A-2,1500,30x50,North-East,no,30,1850,,Booked,Phase 1,,",
    "B-1,2400,40x60,West,no,40,,4800000,Sold,Phase 2,,",
  ];
  return `﻿${[header, ...examples].join("\r\n")}\r\n`;
}
