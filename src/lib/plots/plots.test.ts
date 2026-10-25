import writeExcelFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/plots/csv";
import { MAX_IMPORT_ROWS, plotTemplateCsv, previewPlotRows } from "@/lib/plots/import";
import { readPlotFile, UnreadableFileError } from "@/lib/plots/read-file";
import { parsePlotRow } from "@/lib/plots/row";
import { buildSeries } from "@/lib/plots/series";
import { plotSortKey } from "@/lib/plots/sort";

describe("plotSortKey", () => {
  it("sorts numbers the way people read them", () => {
    const sorted = ["A-10", "A-2", "B-1", "A-1", "a-3"].sort((a, b) =>
      plotSortKey(a).localeCompare(plotSortKey(b)),
    );
    expect(sorted).toEqual(["A-1", "A-2", "a-3", "A-10", "B-1"]);
  });
});

describe("parsePlotRow", () => {
  it("accepts a complete row and normalises it", () => {
    const result = parsePlotRow({
      number: "  A-12 ",
      sizeSqft: "1,200",
      dimensions: "30 X 40",
      facing: "north-east",
      corner: "Yes",
      roadWidthFt: 30,
      ratePerSqft: "₹1,850",
      status: "booked",
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        number: "A-12",
        sizeSqft: 1200,
        dimensions: "30x40",
        facing: "NORTH_EAST",
        isCorner: true,
        roadWidthFt: 30,
        ratePerSqft: 1850,
        price: 2_220_000,
        status: "BOOKED",
      }),
    });
  });

  it("keeps an explicit price over the computed one", () => {
    const result = parsePlotRow({
      number: "1",
      sizeSqft: 1000,
      ratePerSqft: 2000,
      price: 2_500_000,
    });
    expect(result.ok && result.value.price).toBe(2_500_000);
  });

  it("defaults to an available, non-corner plot", () => {
    const result = parsePlotRow({ number: "7", sizeSqft: 900 });
    expect(result.ok && result.value).toMatchObject({
      status: "AVAILABLE",
      isCorner: false,
      facing: null,
    });
  });

  it("reports every problem in a row at once", () => {
    const result = parsePlotRow({
      number: "",
      sizeSqft: "big",
      dimensions: "forty by thirty",
      facing: "up",
      corner: "maybe",
      status: "held",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(6);
  });

  it.each([
    [{ number: "A-1", sizeSqft: 10 }, "Size"],
    [{ number: "A-1", sizeSqft: 5_000_000 }, "Size"],
    [{ number: "x".repeat(21), sizeSqft: 1000 }, "20 characters"],
    [{ number: "A<script>", sizeSqft: 1000 }, "letters, digits"],
  ])("rejects %j", (row, fragment) => {
    const result = parsePlotRow(row);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain(fragment);
  });
});

describe("parseCsv", () => {
  it("reads quoted cells with commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "line\nbreak"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("copes with a BOM, mac line endings and no trailing newline", () => {
    expect(parseCsv("﻿a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects the semicolons and tabs that Excel writes in some regions", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });
});

describe("previewPlotRows", () => {
  const header = ["Plot No.", "Size (sq ft)", "Facing", "Rate per sq ft"];

  it("matches headings by their aliases", () => {
    const preview = previewPlotRows([header, ["A-1", 1200, "East", 1850]], []);
    expect(preview.fatal).toBeNull();
    expect(preview.okCount).toBe(1);
    expect(preview.rows[0].value).toMatchObject({
      number: "A-1",
      sizeSqft: 1200,
      facing: "EAST",
      price: 2_220_000,
    });
  });

  it("explains a file with the wrong headings", () => {
    const preview = previewPlotRows(
      [
        ["name", "colour"],
        ["x", "red"],
      ],
      [],
    );
    expect(preview.fatal).toContain("plot_number");
    expect(preview.fatal).toContain("size_sqft");
  });

  it("flags problems per row with the spreadsheet row number", () => {
    const preview = previewPlotRows(
      [header, ["A-1", 1200, "East", ""], ["A-2", "abc", "", ""], ["", 900, "", ""]],
      [],
    );
    expect(preview.okCount).toBe(1);
    expect(preview.errorCount).toBe(2);
    expect(preview.rows.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(preview.rows[1].errors[0]).toContain("Size");
    expect(preview.rows[2].errors[0]).toContain("number is missing");
  });

  it("catches repeats inside the file, ignoring case", () => {
    const preview = previewPlotRows([header, ["A-1", 1000, "", ""], ["a-1", 1100, "", ""]], []);
    expect(preview.rows[1].errors[0]).toContain("repeated");
    expect(preview.rows[1].errors[0]).toContain("row 2");
  });

  it("catches plots that already exist in the project", () => {
    const preview = previewPlotRows(
      [header, ["A-1", 1000, "", ""], ["A-2", 1000, "", ""]],
      ["a-1"],
    );
    expect(preview.rows[0].errors[0]).toContain("already exists");
    expect(preview.rows[1].value).not.toBeNull();
  });

  it("skips blank rows and reports unknown columns", () => {
    const preview = previewPlotRows(
      [["plot_number", "size_sqft", "Notes"], [], ["A-1", 1000, "x"], ["", "", ""]],
      [],
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.ignoredColumns).toEqual(["Notes"]);
  });

  it("refuses an empty file and a file with only headings", () => {
    expect(previewPlotRows([], []).fatal).toContain("empty");
    expect(previewPlotRows([header], []).fatal).toContain("no plots");
  });

  it("refuses an oversized import", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`P${i}`, 1000, "", ""]);
    expect(previewPlotRows([header, ...rows], []).fatal).toContain("at most");
  });

  it("the downloadable template is itself a valid import", () => {
    const preview = previewPlotRows(parseCsv(plotTemplateCsv()), []);
    expect(preview.fatal).toBeNull();
    expect(preview.errorCount).toBe(0);
    expect(preview.okCount).toBe(3);
    expect(preview.rows.map((r) => r.value?.status)).toEqual(["AVAILABLE", "BOOKED", "SOLD"]);
  });
});

describe("readPlotFile", () => {
  it("reads a real .xlsx file", async () => {
    const buffer = await writeExcelFile([
      ["plot_number", "size_sqft", "facing"],
      ["A-1", 1200, "East"],
      ["A-2", 1500, "West"],
    ]).toBuffer();
    const table = await readPlotFile(Buffer.from(buffer));
    expect(table).toEqual([
      ["plot_number", "size_sqft", "facing"],
      ["A-1", 1200, "East"],
      ["A-2", 1500, "West"],
    ]);
    expect(previewPlotRows(table, []).okCount).toBe(2);
  });

  it("reads CSV text", async () => {
    expect(await readPlotFile(Buffer.from("plot_number,size_sqft\nA-1,1200\n"))).toEqual([
      ["plot_number", "size_sqft"],
      ["A-1", "1200"],
    ]);
  });

  it("explains old .xls files and other binaries instead of failing oddly", async () => {
    await expect(readPlotFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).rejects.toThrow(
      /\.xls/,
    );
    await expect(
      readPlotFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])),
    ).rejects.toBeInstanceOf(UnreadableFileError);
  });

  it("does not crash on a corrupt zip", async () => {
    await expect(
      readPlotFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9])),
    ).rejects.toBeInstanceOf(UnreadableFileError);
  });
});

describe("buildSeries", () => {
  it("builds a numbered run", () => {
    const result = buildSeries({
      prefix: "A-",
      start: 1,
      end: 3,
      padTo: 0,
      sizeSqft: 1200,
      ratePerSqft: 1850,
      facing: "East",
    });
    expect(result.ok && result.plots.map((p) => p.number)).toEqual(["A-1", "A-2", "A-3"]);
    expect(result.ok && result.plots[0]).toMatchObject({
      sizeSqft: 1200,
      price: 2_220_000,
      facing: "EAST",
    });
  });

  it("zero-pads when asked", () => {
    const result = buildSeries({ prefix: "P", start: 8, end: 10, padTo: 3, sizeSqft: 900 });
    expect(result.ok && result.plots.map((p) => p.number)).toEqual(["P008", "P009", "P010"]);
  });

  it.each([
    [{ start: 5, end: 1 }, "same as or higher"],
    [{ start: 1, end: 600 }, "at most 500"],
    [{ start: 1.5, end: 3 }, "whole numbers"],
    [{ start: -1, end: 3 }, "same as or higher"],
    [{ prefix: "x".repeat(11) }, "10 characters"],
    [{ padTo: 9 }, "between 0 and 8"],
    [{ sizeSqft: "" }, "Size"],
    [{ sizeSqft: 5 }, "Size"],
  ])("refuses bad input %j", (override, fragment) => {
    const result = buildSeries({
      prefix: "A-",
      start: 1,
      end: 3,
      padTo: 0,
      sizeSqft: 1000,
      ...override,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(fragment);
  });
});
