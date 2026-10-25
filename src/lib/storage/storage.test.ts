import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brandingKey, chooseStorageDriver, documentKey, isPublicKey } from "@/lib/storage";
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
