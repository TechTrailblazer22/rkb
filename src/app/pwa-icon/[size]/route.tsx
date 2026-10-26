import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

// The home-screen icon. It fills the whole square (no rounded corners, extra margin around the
// letters) so it also works as a "maskable" icon, which phones crop into their own shape.
export async function GET(_request: Request, context: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await context.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#13a89e",
        color: "#ffffff",
        fontSize: Math.round(size * 0.3),
        fontWeight: 800,
        letterSpacing: -2,
      }}
    >
      RKB
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
