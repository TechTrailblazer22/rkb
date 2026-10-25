import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FileNotFoundError,
  type ReadResult,
  type StorageDriver,
  type Visibility,
} from "@/lib/storage/types";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Only keys this app generates are allowed. Every path segment must be a plain name: no empty
// segments, no "." or "..", no leading dot, no backslashes, so a key can never leave the folder.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isSafeKey(key: string): boolean {
  return key.split("/").every((segment) => SAFE_SEGMENT.test(segment) && !segment.includes(".."));
}

export function createLocalStorage(rootDir?: string): StorageDriver {
  const root = path.resolve(
    /*turbopackIgnore: true*/
    rootDir ?? process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".data", "storage"),
  );

  function resolve(key: string): string {
    if (!isSafeKey(key)) throw new FileNotFoundError(key);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new FileNotFoundError(key);
    return full;
  }

  return {
    name: "local",

    async put({ key, data }) {
      const file = resolve(key);
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ file, data);
    },

    async read(key): Promise<ReadResult> {
      const file = resolve(key);
      try {
        const data = await readFile(/*turbopackIgnore: true*/ file);
        const ext = path.extname(file).slice(1).toLowerCase();
        return {
          kind: "bytes",
          data,
          contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(key);
        throw error;
      }
    },

    publicUrl(key) {
      return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
    },

    async remove(key, _visibility: Visibility) {
      try {
        await unlink(/*turbopackIgnore: true*/ resolve(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
