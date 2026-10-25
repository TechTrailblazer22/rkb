import { getStorage } from "@/lib/storage";

/**
 * Address of a public file, or null when storage is not set up, so a page still renders
 * (with a placeholder) instead of failing outright.
 */
export function safePublicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  try {
    return getStorage().publicUrl(key);
  } catch {
    return null;
  }
}
