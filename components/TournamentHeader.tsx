// components/TournamentHeader.tsx
"use client";
import type { TournamentSummary } from "@/lib/types";

interface Props {
  summary: TournamentSummary;
}

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${parseFloat(k.toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${parseFloat(m.toFixed(2))}M`;
}

export default function TournamentHeader({ summary }: Props) {
  const isLive    = summary.games_completed > 0 && summary.games_completed < 63;
  const isPending = summary.games_completed === 0;
  const isDone    = summary.games_completed === 63;
  const statusLabel = isPending ? "PRE-TOURNAMENT" : isDone ? "FINAL" : "LIVE";
  const progress    = Math.round((summary.games_completed / 63) * 100);

  return (
    <header style={{ borderBottom: "1px solid var(--border)", marginBottom: 32 }}>
      {/* Top bar */}
      <div style={{
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        maxWidth: 1280,
        margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)",
          }}>
            2026 March Madness
          </span>
          <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
          <span className={`tag ${isLive ? "tag-live" : ""}`}
            style={!isLive ? { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" } : {}}>
            {isLive && (
              <span className="pulse-live" style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--accent)", display: "inline-block", marginRight: 6,
              }} />
            )}
            {statusLabel}
          </span>
        </div>
        {summary.last_updated && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            Updated {new Date(summary.last_updated).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Main header */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px 0" }}>
        {/* Title + subtitle — centered */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(40px, 6vw, 72px)",
            fontWeight: 800,
            letterSpacing: "-0.01em",
            lineHeight: 1,
            color: "var(--text-primary)",
          }}>
            BRACKET TRACKER
          </h1>
          <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 14, fontFamily: "var(--font-body)" }}>
            ML-generated portfolio · 2026 NCAA Tournament
          </p>
        </div>

        {/* Stats row — centered, bordered */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          borderTop: "1px solid var(--border)",
          borderLeft: "1px solid var(--border)",
        }}>
          <Stat label="Brackets"          value={smartNum(summary.total_brackets)} />
          <Stat label="Games Done"        value={`${summary.games_completed} / 63`} />
          <Stat label="Top Score"         value={summary.top_score > 0 ? summary.top_score.toLocaleString() : "—"} accent />
          <Stat label="Champions Picked"  value={smartNum(summary.unique_champions)} />
          <Stat label="Perfect Remaining" value={(summary as any).perfect_remaining != null ? smartNum((summary as any).perfect_remaining) : "—"} />
        </div>

        {/* Progress bar */}
        {!isPending && (
          <div style={{ padding: "16px 0 20px" }}>
            <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progress}%`,
                background: isLive ? "linear-gradient(90deg, var(--accent), #fbbf24)" : "var(--correct)",
                borderRadius: 2, transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", marginTop: 6,
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)",
            }}>
              <span>R64</span><span>R32</span><span>S16</span><span>E8</span><span>F4</span><span>CHAMP</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      padding: "18px 32px",
      textAlign: "center",
      borderRight: "1px solid var(--border)",
      borderBottom: "1px solid var(--border)",
    }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: "var(--accent)" } : {}}>{value}</div>
    </div>
  );
}
