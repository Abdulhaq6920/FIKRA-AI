"use client";

/**
 * Last-resort error boundary.
 *
 * A regular `error.tsx` cannot catch an error thrown by the root layout itself.
 * When that happens Next renders `global-error.tsx` *instead of* the layout,
 * so this component owns `<html>` and `<body>` and cannot rely on the app's
 * stylesheet, providers or theme. Styling is therefore inline and minimal.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#e5e7eb",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            FIKRA AI could not start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#9ca3af", margin: "0 0 20px" }}>
            The application shell failed to load. Reloading usually fixes this; if
            it keeps happening, contact your administrator.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 11,
                color: "#6b7280",
                margin: "0 0 20px",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: 8,
                border: "1px solid #3b82f6",
                background: "#2563eb",
                color: "#fff",
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/chat")}
              style={{
                borderRadius: 8,
                border: "1px solid #374151",
                background: "transparent",
                color: "#e5e7eb",
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
