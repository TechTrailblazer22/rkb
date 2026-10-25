import { describe, expect, it } from "vitest";
import { detectFileType, formatBytes, safeFilename } from "@/lib/storage/sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

describe("detectFileType", () => {
  it("recognises PDF, JPEG, PNG and WebP by their bytes", () => {
    expect(detectFileType(ascii("%PDF-1.7\n..."))?.mime).toBe("application/pdf");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))?.mime).toBe("image/jpeg");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mime).toBe(
      "image/png",
    );
    expect(detectFileType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))?.mime).toBe("image/webp");
  });

  it("flags images so logos can be restricted to pictures", () => {
    expect(detectFileType(ascii("%PDF-1.4"))?.isImage).toBe(false);
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.isImage).toBe(true);
  });

  it.each([
    ["an HTML page renamed to .pdf", ascii("<html><script>alert(1)</script>")],
    ["a Windows executable", ascii("MZ\u0090\u0000\u0003")],
    ["an SVG with script", ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ["a zip archive", bytes(0x50, 0x4b, 0x03, 0x04)],
    ["RIFF that is not WebP", ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt ")],
    ["an empty file", new Uint8Array()],
    ["a truncated PDF header", ascii("%PD")],
  ])("rejects %s", (_name, data) => {
    expect(detectFileType(data)).toBeNull();
  });
});

describe("safeFilename", () => {
  it("drops folders and control characters", () => {
    expect(safeFilename("C:\\Users\\me\\scan.pdf")).toBe("scan.pdf");
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("bad\u0000name\n.pdf")).toBe("badname.pdf");
  });

  it("falls back to a default and bounds the length", () => {
    expect(safeFilename("")).toBe("file");
    expect(safeFilename("///")).toBe("file");
    expect(safeFilename("a".repeat(500)).length).toBe(120);
  });
});

describe("formatBytes", () => {
  it("uses a readable unit", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
