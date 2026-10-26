import { getStorage } from "@/lib/storage";

/**
 * Address of a public file, or null when storage is not set up, so a page still renders
 * (with a placeholder) instead of failing outright. `width` asks for a smaller picture where
 * the storage can resize (Cloudinary); it is only a hint.
 */
export function safePublicUrl(key: string | null | undefined, width?: number): string | null {
  if (!key) return null;
  try {
    return getStorage().publicUrl(key, width ? { width } : undefined);
  } catch {
    return null;
  }
}
