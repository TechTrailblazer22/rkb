export type Visibility = "public" | "private";

export type ReadResult =
  { kind: "redirect"; url: string } | { kind: "bytes"; data: Buffer; contentType: string };

/**
 * Where uploaded files live. Render's disk is wiped on every restart, so production uses
 * Cloudinary; the local driver exists for development and automated tests only.
 */
export interface StorageDriver {
  readonly name: "local" | "cloudinary";
  put(input: {
    key: string;
    data: Buffer;
    contentType: string;
    visibility: Visibility;
  }): Promise<void>;
  /** Private files only: returns a short-lived link, or the bytes themselves. */
  read(key: string, visibility: Visibility, expiresInSeconds: number): Promise<ReadResult>;
  /** Address of a public file (logos, covers). */
  publicUrl(key: string): string;
  remove(key: string, visibility: Visibility): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "File storage is not configured. Set CLOUDINARY_URL (or STORAGE_DRIVER=local for development).",
    );
    this.name = "StorageNotConfiguredError";
  }
}

export class FileNotFoundError extends Error {
  constructor(key: string) {
    super(`File not found: ${key}`);
    this.name = "FileNotFoundError";
  }
}
