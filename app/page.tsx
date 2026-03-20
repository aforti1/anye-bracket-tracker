// app/page.tsx
// Landing page with Men's / Women's cards and About modal
"use client";

import { useState } from "react";
import Link from "next/link";
import AboutModal from "@/components/AboutModal";

export default function LandingPage() {
  const [showAbout, setShowAbout] = useState(false);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        position: "relative",
      }}
    >
      {/* Title block */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Bracket Portfolio · 2026 March Madness
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(36px, 6vw, 64px)",
            fontWeight: 800,
            letterSpacing: "0.02em",
            color: "var(--text-primary)",
            lineHeight: 1.05,
            textTransform: "uppercase",
          }}
        >
          Anye Bracket Tracker
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 14,
            color: "var(--text-secondary)",
            marginTop: 12,
            maxWidth: 480,
            margin: "12px auto 0",
            lineHeight: 1.6,
          }}
        >
          ML-generated bracket portfolios tracking real tournament results in real time.
          Choose a tournament to explore.
        </p>
      </div>

      {/* Tournament cards */}
      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 680,
          width: "100%",
          marginBottom: 48,
        }}
      >
        <TournamentCard
          href="/mens"
          label="Men's"
          title="Men's Brackets"
          description="NCAA Men's Division I Tournament"
          accentColor="var(--accent)"
        />
        <TournamentCard
          href="/womens"
          label="Women's"
          title="Women's Brackets"
          description="NCAA Women's Division I Tournament"
          accentColor="#a855f7"
        />
      </div>

      {/* About button */}
      <button
        onClick={() => setShowAbout(true)}
        style={{
          background: "linear-gradient(135deg, #f5a623, #e8941a)",
          border: "1px solid #f5a62366",
          borderRadius: 6,
          padding: "8px 20px",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: "#0a0a0b",
          letterSpacing: "0.04em",
          boxShadow: "0 0 12px rgba(245, 166, 35, 0.15)",
        }}
      >
        About
      </button>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </main>
  );
}


function TournamentCard({
  href,
  label,
  title,
  description,
  accentColor,
}: {
  href: string;
  label: string;
  title: string;
  description: string;
  accentColor: string;
}) {
  return (
    <Link
      href={href}
      style={{
        flex: "1 1 280px",
        maxWidth: 320,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        className="tournament-card"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "32px 28px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: accentColor,
            opacity: 0.6,
          }}
        />

        {/* Label */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            color: accentColor,
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {label}
        </div>

        {/* Title */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "0.01em",
            color: "var(--text-primary)",
            lineHeight: 1.1,
            marginBottom: 8,
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            marginBottom: 20,
          }}
        >
          {description}
        </div>

        {/* Arrow */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: accentColor,
            letterSpacing: "0.05em",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          View brackets
          <span style={{ transition: "transform 0.2s" }} className="card-arrow">→</span>
        </div>
      </div>
    </Link>
  );
}
