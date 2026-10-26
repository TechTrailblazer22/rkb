import { v2 as cloudinary } from "cloudinary";
import type { ReadResult, StorageDriver, Visibility } from "@/lib/storage/types";

// Cloudinary reads CLOUDINARY_URL (cloudinary://API_KEY:API_SECRET@CLOUD_NAME) on its own.
//
// Everything is stored as resource_type "image", including PDFs, so one code path serves all.
// Private files use delivery type "authenticated": they cannot be fetched by URL at all, only
// through a signed link we create on demand with a short expiry.
//
// In Cloudinary's settings, "Security > PDF and ZIP files delivery" must be switched on, or
// PDFs will upload but not download.

function split(key: string): { publicId: string; format: string } {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return { publicId: key, format: "" };
  return { publicId: key.slice(0, dot), format: key.slice(dot + 1) };
}

const deliveryType = (visibility: Visibility) =>
  visibility === "private" ? "authenticated" : "upload";

export function createCloudinaryStorage(): StorageDriver {
  cloudinary.config({ secure: true });

  return {
    name: "cloudinary",

    async put({ key, data, visibility }) {
      const { publicId } = split(key);
      await new Promise<void>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: "image",
            type: deliveryType(visibility),
            overwrite: false,
            unique_filename: false,
          },
          (error) => (error ? reject(error) : resolve()),
        );
        stream.end(data);
      });
    },

    async read(key, visibility, expiresInSeconds): Promise<ReadResult> {
      const { publicId, format } = split(key);
      const url = cloudinary.utils.private_download_url(publicId, format, {
        resource_type: "image",
        type: deliveryType(visibility),
        expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
      });
      return { kind: "redirect", url };
    },

    publicUrl(key, options) {
      const { publicId, format } = split(key);
      // A PDF (a brochure) must stay a PDF. Pictures get f_auto and q_auto so Cloudinary picks
      // the smallest good format for each browser.
      if (format === "pdf") {
        return cloudinary.url(publicId, {
          secure: true,
          resource_type: "image",
          type: "upload",
          format: "pdf",
        });
      }
      return cloudinary.url(publicId, {
        secure: true,
        resource_type: "image",
        type: "upload",
        fetch_format: "auto",
        quality: "auto",
        // Never larger than asked for, so a phone card does not download a desktop-sized photo.
        ...(options?.width ? { width: options.width, crop: "limit" } : {}),
      });
    },

    async remove(key, visibility) {
      const { publicId } = split(key);
      await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
        type: deliveryType(visibility),
        invalidate: true,
      });
    },
  };
}
