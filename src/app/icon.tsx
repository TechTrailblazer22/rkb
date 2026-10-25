import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#13a89e",
        borderRadius: 14,
        color: "#ffffff",
        fontSize: 27,
        fontWeight: 800,
        letterSpacing: -1,
      }}
    >
      RKB
    </div>,
    size,
  );
}
