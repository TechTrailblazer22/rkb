import { randomBytes } from "node:crypto";
import type { DocumentKind } from "@/generated/prisma/enums";
import { createCloudinaryStorage } from "@/lib/storage/cloudinary";
import { createLocalStorage } from "@/lib/storage/local";
import { StorageNotConfiguredError, type StorageDriver } from "@/lib/storage/types";

export type StorageDriverName = "local" | "cloudinary" | "none";

/** Explicit STORAGE_DRIVER wins; otherwise Cloudinary if configured; local only outside production. */
export function chooseStorageDriver(env: Record<string, string | undefined>): StorageDriverName {
  const explicit = env.STORAGE_DRIVER;
  if (explicit === "local" || explicit === "cloudinary") return explicit;
  if (env.CLOUDINARY_URL) return "cloudinary";
  return env.NODE_ENV === "production" ? "none" : "local";
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (!driver) {
    const name = chooseStorageDriver(process.env);
    if (name === "none") throw new StorageNotConfiguredError();
    driver = name === "cloudinary" ? createCloudinaryStorage() : createLocalStorage();
  }
  return driver;
}

function token(): string {
  // The random part stops a replaced file being served from a stale cache.
  return randomBytes(6).toString("hex");
}

/** Private: verification documents. Never publicly addressable. */
export function documentKey(builderId: string, kind: DocumentKind, ext: string): string {
  return `builders/${builderId}/docs/${kind.toLowerCase()}-${token()}.${ext}`;
}

/** Public: logo and cover. The "/public/" segment is what lets the file route serve it. */
export function brandingKey(builderId: string, which: "logo" | "cover", ext: string): string {
  return `builders/${builderId}/public/${which}-${token()}.${ext}`;
}

export function isPublicKey(key: string): boolean {
  return /^builders\/[A-Za-z0-9]+\/public\/[A-Za-z0-9._-]+$/.test(key);
}
