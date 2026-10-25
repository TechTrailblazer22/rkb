// Upload checks. The type is decided from the file's own bytes, never from its name or the
// Content-Type header, both of which the sender controls.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type DetectedType = { mime: string; ext: string; isImage: boolean };

const PDF: DetectedType = { mime: "application/pdf", ext: "pdf", isImage: false };
const JPEG: DetectedType = { mime: "image/jpeg", ext: "jpg", isImage: true };
const PNG: DetectedType = { mime: "image/png", ext: "png", isImage: true };
const WEBP: DetectedType = { mime: "image/webp", ext: "webp", isImage: true };

export function detectFileType(data: Uint8Array): DetectedType | null {
  const startsWith = (bytes: number[], offset = 0) =>
    data.length >= offset + bytes.length && bytes.every((byte, i) => data[offset + i] === byte);

  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF; // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  // WebP: "RIFF" + 4 size bytes + "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return WEBP;
  return null;
}

/** A readable name for display and downloads: no folders, no control characters, bounded length. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
