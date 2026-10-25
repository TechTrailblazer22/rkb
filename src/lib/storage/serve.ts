import { getStorage } from "@/lib/storage";
import { FileNotFoundError } from "@/lib/storage/types";

/** How long a signed link to a private file stays valid. */
export const LINK_LIFETIME_SECONDS = 300;

/**
 * Answers a request for a private file: a redirect to a short-lived signed link (Cloudinary) or
 * the bytes themselves (local development), always with headers that stop the browser caching
 * it or running anything inside it. The caller must have checked who is allowed to see it.
 */
export async function servePrivateFile(
  storageKey: string,
  originalName: string,
): Promise<Response> {
  try {
    const result = await getStorage().read(storageKey, "private", LINK_LIFETIME_SECONDS);
    if (result.kind === "redirect") {
      return new Response(null, {
        status: 302,
        headers: { Location: result.url, "Cache-Control": "private, no-store" },
      });
    }
    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // The file is shown as a plain document and can never run anything.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof FileNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
