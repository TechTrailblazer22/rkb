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

/** Public: a project's photos, layout plan, brochure and progress photos. Shown to buyers. */
export function projectMediaKey(
  builderId: string,
  projectId: string,
  kind: "photo" | "layout" | "brochure" | "progress",
  ext: string,
): string {
  return `builders/${builderId}/public/projects/${projectId}/${kind}-${token()}.${ext}`;
}

/** Private: the document attached to a project approval (RERA certificate and so on). */
export function approvalDocumentKey(builderId: string, approvalKind: string, ext: string): string {
  return `builders/${builderId}/docs/approval-${approvalKind.toLowerCase()}-${token()}.${ext}`;
}

/**
 * A key the public file route may serve: it must sit under "<builder>/public/", with plain
 * folder and file names (no dots-only segments, so no way to climb out of the folder).
 */
export function isPublicKey(key: string): boolean {
  return (
    /^builders\/[A-Za-z0-9]+\/public\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) &&
    !key.includes("..")
  );
}
