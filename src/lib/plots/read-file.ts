import { readSheet } from "read-excel-file/node";
import { parseCsv } from "@/lib/plots/csv";

export class UnreadableFileError extends Error {}

/**
 * Reads an uploaded .xlsx or .csv into rows of cells. The format comes from the file's own
 * bytes, not its name.
 */
export async function readPlotFile(data: Buffer): Promise<unknown[][]> {
  // .xlsx is a zip archive: "PK\x03\x04"
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    try {
      return (await readSheet(data)) as unknown[][];
    } catch {
      throw new UnreadableFileError(
        "That Excel file could not be read. Try saving it again as .xlsx or CSV.",
      );
    }
  }
  // old binary .xls: "D0 CF 11 E0"
  if (
    data.length >= 4 &&
    data[0] === 0xd0 &&
    data[1] === 0xcf &&
    data[2] === 0x11 &&
    data[3] === 0xe0
  ) {
    throw new UnreadableFileError(
      "Old .xls files are not supported. In Excel choose Save As, then .xlsx or CSV.",
    );
  }
  // Anything else must be plain text. NUL bytes mean it is some other binary format.
  if (data.subarray(0, 2000).includes(0)) {
    throw new UnreadableFileError("Upload an Excel (.xlsx) or CSV file.");
  }
  return parseCsv(data.toString("utf8"));
}
