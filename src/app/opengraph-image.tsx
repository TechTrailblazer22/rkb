import { ImageResponse } from "next/og";

export const alt = "RKB Platform: your projects, in every buyer's pocket";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOURS = { A: "#13a89e", B: "#f5a300", S: "#3a5778" } as const;
const GRID = ["BASAABAAABBB", "BAABAABBABAS", "AAASABBAAAAA", "ASAABSBASASA", "AABAAAAAAAAA"];

// Shown when a link to the site is shared on WhatsApp, Facebook, LinkedIn and similar.
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0b2545",
        color: "#ffffff",
        padding: 64,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            background: "#13a89e",
            borderRadius: 14,
            padding: "8px 18px",
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          RKB
        </div>
        <div style={{ display: "flex", fontSize: 28, opacity: 0.8 }}>Platform</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>
          Your projects, in every buyer&apos;s pocket.
        </div>
        <div
          style={{
            display: "flex",
            width: 110,
            height: 10,
            borderRadius: 5,
            background: "#f5a300",
            marginTop: 28,
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {GRID.map((row, r) => (
          <div key={r} style={{ display: "flex", gap: 8 }}>
            {row.split("").map((cell, c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  width: 56,
                  height: 24,
                  borderRadius: 5,
                  background: COLOURS[cell as keyof typeof COLOURS],
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
