// components/TournamentHeader.tsx
import type { TournamentSummary } from "@/lib/types";

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    if (k >= 100) return `${Math.round(k)}K`;
    if (k >= 10) return `${parseFloat((Math.round(k * 10) / 10).toFixed(1))}K`;
    return `${parseFloat((Math.round(k * 100) / 100).toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  if (m >= 100) return `${Math.round(m)}M`;
  if (m >= 10) return `${parseFloat((Math.round(m * 10) / 10).toFixed(1))}M`;
  return `${parseFloat((Math.round(m * 100) / 100).toFixed(2))}M`;
}

interface Props { summary: TournamentSummary; gender?: "mens" | "womens"; }

export default function TournamentHeader({ summary, gender }: Props) {
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
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Bracket Portfolio · 2026 {gender === "womens" ? "Women's " : ""}March Madness</div>
          <a href="/" style={{ textDecoration: "none" }}><h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "0.02em", color: "var(--text-primary)", lineHeight: 1.1, textTransform: "uppercase", cursor: "pointer" }}>Anye Bracket Tracker</h1></a>
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
