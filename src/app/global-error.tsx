"use client"

/**
 * Global error boundary — catches errors that escape from the root layout
 * itself. This file replaces the entire HTML document so it MUST include
 * <html> and <body>. We can't import the regular UI primitives because the
 * layout (and therefore the providers + theme variables) failed to render.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
                    backgroundColor: "#0a0e1a",
                    color: "#ededed",
                    minHeight: "100vh",
                    display: "grid",
                    placeItems: "center",
                    padding: "1.5rem",
                }}
            >
                <div
                    style={{
                        maxWidth: 480,
                        width: "100%",
                        background: "rgba(20, 24, 35, 0.6)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 16,
                        padding: "3rem 2rem",
                        textAlign: "center",
                    }}
                >
                    <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 12 }}>
                        Critical error
                    </h1>
                    <p style={{ color: "#9aa3b2", fontSize: 14, marginBottom: 24 }}>
                        The app couldn&apos;t recover. Refresh the page or contact support.
                    </p>
                    {error.digest && (
                        <code style={{ fontSize: 10, color: "#6b7280", display: "block", wordBreak: "break-all", marginBottom: 16 }}>
                            {error.digest}
                        </code>
                    )}
                    <button
                        onClick={reset}
                        style={{
                            padding: "10px 20px",
                            fontSize: 14,
                            fontWeight: 600,
                            color: "#0a0e1a",
                            background: "linear-gradient(135deg, #22d3ee, #ec4899)",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    )
}