import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approvalDocumentKey,
  brandingKey,
  chooseStorageDriver,
  documentKey,
  isPublicKey,
  projectMediaKey,
} from "@/lib/storage";
import { createLocalStorage } from "@/lib/storage/local";
import { FileNotFoundError } from "@/lib/storage/types";

describe("chooseStorageDriver", () => {
  it("honours an explicit choice", () => {
    expect(chooseStorageDriver({ STORAGE_DRIVER: "local", NODE_ENV: "production" })).toBe("local");
    expect(chooseStorageDriver({ STORAGE_DRIVER: "cloudinary" })).toBe("cloudinary");
  });

  it("uses Cloudinary whenever it is configured", () => {
    expect(
      chooseStorageDriver({ CLOUDINARY_URL: "cloudinary://k:s@c", NODE_ENV: "production" }),
    ).toBe("cloudinary");
  });

  it("falls back to local disk in development only", () => {
    expect(chooseStorageDriver({ NODE_ENV: "development" })).toBe("local");
    expect(chooseStorageDriver({})).toBe("local");
  });

  it("refuses to use local disk in production, where files would silently vanish", () => {
    expect(chooseStorageDriver({ NODE_ENV: "production" })).toBe("none");
  });
});

describe("storage keys", () => {
  it("builds unique private document keys", () => {
    const a = documentKey("b1", "PAN", "pdf");
    const b = documentKey("b1", "PAN", "pdf");
    expect(a).toMatch(/^builders\/b1\/docs\/pan-[0-9a-f]{12}\.pdf$/);
    expect(a).not.toBe(b);
    expect(isPublicKey(a)).toBe(false);
  });

  it("marks only branding keys as public", () => {
    const key = brandingKey("b1", "logo", "png");
    expect(key).toMatch(/^builders\/b1\/public\/logo-[0-9a-f]{12}\.png$/);
    expect(isPublicKey(key)).toBe(true);
    expect(isPublicKey("builders/b1/docs/pan-abc.pdf")).toBe(false);
    expect(isPublicKey("builders/b1/public/../docs/pan.pdf")).toBe(false);
    expect(isPublicKey("../builders/b1/public/logo.png")).toBe(false);
  });
});

describe("project media keys", () => {
  it("puts photos, layouts and brochures in a public project folder the file route can serve", () => {
    for (const kind of ["photo", "layout", "brochure"] as const) {
      const key = projectMediaKey("b1", "p1", kind, "jpg");
      expect(key.startsWith(`builders/b1/public/projects/p1/${kind}-`)).toBe(true);
      expect(key.endsWith(".jpg")).toBe(true);
      expect(isPublicKey(key)).toBe(true);
    }
  });

  it("gives every upload its own address, so a replaced file is never served from a stale cache", () => {
    expect(projectMediaKey("b1", "p1", "photo", "jpg")).not.toBe(
      projectMediaKey("b1", "p1", "photo", "jpg"),
    );
  });

  it("keeps approval documents private", () => {
    const key = approvalDocumentKey("b1", "RERA", "pdf");
    expect(key).toMatch(/^builders\/b1\/docs\/approval-rera-[0-9a-f]{12}\.pdf$/);
    expect(isPublicKey(key)).toBe(false);
  });

  it.each([
    "builders/b1/public/projects/../docs/pan.pdf",
    "builders/b1/public/projects/./x.jpg",
    "builders/b1/public//x.jpg",
    "builders/b1/public/projects/p1/.hidden",
    "builders/b1/docs/projects/p1/photo.jpg",
    "builders/b1/public",
    "builders/b1/public/",
  ])("does not serve %s", (key) => {
    expect(isPublicKey(key)).toBe(false);
  });
});

describe("local storage driver", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "rkb-storage-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores, reads back and removes a file", async () => {
    const storage = createLocalStorage(dir);
    const key = "builders/b1/docs/pan-abc123.pdf";
    await storage.put({
      key,
      data: Buffer.from("%PDF-1.4 hello"),
      contentType: "application/pdf",
      visibility: "private",
    });

    const result = await storage.read(key, "private", 60);
    expect(result.kind).toBe("bytes");
    if (result.kind === "bytes") {
      expect(result.contentType).toBe("application/pdf");
      expect(result.data.toString()).toBe("%PDF-1.4 hello");
    }

    await storage.remove(key, "private");
    await expect(storage.read(key, "private", 60)).rejects.toBeInstanceOf(FileNotFoundError);
    await storage.remove(key, "private"); // removing twice is fine
  });

  it("refuses keys that try to escape the storage folder", async () => {
    const storage = createLocalStorage(dir);
    for (const key of [
      "../outside.txt",
      "builders/../../outside.txt",
      "/etc/passwd",
      "a/./b",
      "a\\b",
    ]) {
      await expect(
        storage.put({
          key,
          data: Buffer.from("x"),
          contentType: "text/plain",
          visibility: "private",
        }),
      ).rejects.toBeInstanceOf(FileNotFoundError);
    }
    expect((await readdir(path.dirname(dir))).includes("outside.txt")).toBe(false);
  });

  it("gives public files an app URL", () => {
    expect(createLocalStorage(dir).publicUrl("builders/b1/public/logo-abc.png")).toBe(
      "/api/files/builders/b1/public/logo-abc.png",
    );
  });
});
