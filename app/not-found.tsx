// app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 24,
    }}>
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.12em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
      }}>
        404
      </div>
      <h1 style={{
        fontFamily: "var(--font-display)",
        fontSize: "clamp(32px, 6vw, 64px)",
        fontWeight: 800,
        letterSpacing: "-0.01em",
        color: "var(--text-primary)",
      }}>
        BRACKET NOT FOUND
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
        That bracket ID doesn't exist in the portfolio.
      </p>
      <Link href="/" style={{
        marginTop: 8,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        color: "var(--accent)",
        textDecoration: "none",
        border: "1px solid var(--accent-glow)",
        borderRadius: 6,
        padding: "8px 20px",
      }}>
        ← Back to leaderboard
      </Link>
    </main>
  );
}
