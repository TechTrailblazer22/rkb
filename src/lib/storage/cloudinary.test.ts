import { beforeEach, describe, expect, it, vi } from "vitest";

// The real service cannot be called from automated tests, so this checks that we hand
// Cloudinary the arguments that keep private files private. A live check is in
// `npm run storage:check`, to run once your Cloudinary account is set up.
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  upload_stream: vi.fn(),
  destroy: vi.fn(),
  private_download_url: vi.fn(() => "https://api.cloudinary.com/signed"),
  url: vi.fn(() => "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/x"),
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: mocks.config,
    uploader: { upload_stream: mocks.upload_stream, destroy: mocks.destroy },
    utils: { private_download_url: mocks.private_download_url },
    url: mocks.url,
  },
}));

import { createCloudinaryStorage } from "@/lib/storage/cloudinary";

beforeEach(() => vi.clearAllMocks());

describe("cloudinary driver", () => {
  it("uploads private files as 'authenticated' so they have no public URL", async () => {
    mocks.upload_stream.mockImplementation((_options, callback: (e: null) => void) => ({
      end: () => callback(null),
    }));
    await createCloudinaryStorage().put({
      key: "builders/b1/docs/pan-abc.pdf",
      data: Buffer.from("%PDF-1.4"),
      contentType: "application/pdf",
      visibility: "private",
    });
    expect(mocks.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: "builders/b1/docs/pan-abc",
        type: "authenticated",
        resource_type: "image",
        overwrite: false,
      }),
      expect.any(Function),
    );
  });

  it("uploads branding images as public", async () => {
    mocks.upload_stream.mockImplementation((_options, callback: (e: null) => void) => ({
      end: () => callback(null),
    }));
    await createCloudinaryStorage().put({
      key: "builders/b1/public/logo-abc.png",
      data: Buffer.from("png"),
      contentType: "image/png",
      visibility: "public",
    });
    expect(mocks.upload_stream.mock.calls[0][0]).toMatchObject({ type: "upload" });
  });

  it("reports upload failures instead of swallowing them", async () => {
    mocks.upload_stream.mockImplementation((_options, callback: (e: Error) => void) => ({
      end: () => callback(new Error("quota exceeded")),
    }));
    await expect(
      createCloudinaryStorage().put({
        key: "builders/b1/docs/pan-abc.pdf",
        data: Buffer.from("x"),
        contentType: "application/pdf",
        visibility: "private",
      }),
    ).rejects.toThrow("quota exceeded");
  });

  it("reads private files through a signed link that expires", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const result = await createCloudinaryStorage().read(
      "builders/b1/docs/pan-abc.pdf",
      "private",
      300,
    );
    vi.useRealTimers();

    expect(result).toEqual({ kind: "redirect", url: "https://api.cloudinary.com/signed" });
    const [publicId, format, options] = mocks.private_download_url.mock.calls[0] as unknown as [
      string,
      string,
      { type: string; expires_at: number },
    ];
    expect(publicId).toBe("builders/b1/docs/pan-abc");
    expect(format).toBe("pdf");
    expect(options.type).toBe("authenticated");
    expect(options.expires_at).toBe(
      Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) + 300,
    );
  });

  it("deletes with the right delivery type", async () => {
    mocks.destroy.mockResolvedValue({ result: "ok" });
    await createCloudinaryStorage().remove("builders/b1/docs/pan-abc.pdf", "private");
    expect(mocks.destroy).toHaveBeenCalledWith(
      "builders/b1/docs/pan-abc",
      expect.objectContaining({ type: "authenticated", invalidate: true }),
    );
  });
});
