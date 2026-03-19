// components/BackButton.tsx
"use client";

export default function BackButton() {
  return (
    <button
      onClick={() => window.history.back()}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text-muted)",
        textDecoration: "none",
        letterSpacing: "0.06em",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      ← LEADERBOARD
    </button>
  );
}
