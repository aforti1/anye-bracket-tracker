// components/TournamentHeader.tsx
import type { TournamentSummary } from "@/lib/types";

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${parseFloat(k.toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${parseFloat(m.toFixed(2))}M`;
}

interface Props { summary: TournamentSummary; }

export default function TournamentHeader({ summary }: Props) {
  const { total_brackets, games_completed, games_total, top_score, unique_champions, perfect_remaining } = summary;
  const stats = [
    { label: "Brackets",          value: smartNum(total_brackets) },
    { label: "Games Done",        value: `${games_completed}/${games_total}` },
    { label: "Top Score",         value: top_score > 0 ? String(top_score) : "—" },
    { label: "Champions Picked",  value: String(unique_champions) },
    { label: "Perfect Remaining", value: smartNum(perfect_remaining ?? 0) },
  ];
  return (
    <div style={{ borderBottom: "1px solid var(--border)", marginBottom: 32 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 24px" }}>
        <div style={{ marginBottom: 20, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Bracket Portfolio · 2026 March Madness</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "0.02em", color: "var(--text-primary)", lineHeight: 1.1, textTransform: "uppercase" }}>Anye Bracket Tracker</h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 0, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-card)", maxWidth: 800, margin: "0 auto" }}>
          {stats.map((stat, i) => (
            <div key={stat.label} style={{ flex: "1 1 0", minWidth: 100, padding: "12px 14px", borderLeft: i > 0 ? "1px solid var(--border)" : "none", textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
