"use client";

// The last resort: used only if the root layout itself fails. It must bring its own <html> and
// <body>, so it uses plain styles and depends on nothing else.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "1rem",
          color: "#0b1f3a",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "28rem", color: "#475569" }}>
          We could not show this page. It was our fault, not yours. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1.5rem",
            borderRadius: "0.5rem",
            border: 0,
            background: "#0f766e",
            color: "white",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
