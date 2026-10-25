import { getStorage, isPublicKey } from "@/lib/storage";
import { FileNotFoundError } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

// Serves public builder images (logo, cover) when files live on local disk (development and
// tests). With Cloudinary, images are served from Cloudinary and this route is unused.
// Only keys under ".../public/..." are ever served; verification documents cannot be reached here.
export async function GET(_request: Request, context: RouteContext<"/api/files/[...key]">) {
  const { key: segments } = await context.params;
  const key = segments.join("/");
  if (!isPublicKey(key)) return new Response("Not found", { status: 404 });

  const storage = getStorage();
  if (storage.name !== "local") return new Response("Not found", { status: 404 });

  try {
    const result = await storage.read(key, "public", 0);
    if (result.kind !== "bytes") return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Type": result.contentType,
        // Keys contain a random token, so a given URL never changes content.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof FileNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
