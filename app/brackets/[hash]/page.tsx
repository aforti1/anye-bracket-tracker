// app/brackets/[hash]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import BracketView from "@/components/BracketView";
import type { BracketDetail } from "@/lib/types";
import { formatAccuracy } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${parseFloat(k.toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${parseFloat(m.toFixed(2))}M`;
}

function formatRank(rank: number | null): string {
  if (rank === null) return "—";
  return smartNum(rank);
}

async function getBracket(hash: string): Promise<BracketDetail | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/brackets/${hash}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getTotalBrackets(): Promise<number> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/summary`, { next: { revalidate: 30 } });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.total_brackets ?? 0;
}

export default async function BracketPage({ params }: { params: { hash: string } }) {
  const bracket = await getBracket(params.hash.toUpperCase());
  if (!bracket) notFound();

  const accuracy = formatAccuracy(bracket.correct_picks, bracket.games_decided);
  const rankStr  = formatRank(bracket.rank);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", marginBottom: 32 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
          <Link href="/" style={{
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
            textDecoration: "none", letterSpacing: "0.06em",
          }}>
            ← LEADERBOARD
          </Link>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 20 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h1 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(28px, 4vw, 48px)",
                  fontWeight: 800, letterSpacing: "-0.01em", color: "var(--accent)",
                }}>
                  {bracket.bracket_hash}
                </h1>
                {bracket.rank && bracket.rank <= 100 && (
                  <span className="tag tag-correct" style={{ fontSize: 12 }}>TOP 100</span>
                )}
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
                ML-generated bracket · 2026 NCAA Tournament
              </p>
            </div>

            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <MiniStat label="Score"    value={bracket.total_points.toLocaleString()} accent />
              <MiniStat label="Accuracy" value={accuracy} />
              <MiniStat label="Rank"     value={rankStr} />
              <MiniStat label="Champion" value={bracket.champion_name ?? "—"} />
              <MiniStat label="Upsets"   value={String(bracket.upset_count)} />
            </div>
          </div>
        </div>
      </div>

      {/* Bracket visualization */}
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 16px 48px" }}>
        <BracketView bracket={bracket} />
      </div>
    </main>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700,
        lineHeight: 1.1, color: accent ? "var(--accent)" : "var(--text-primary)", marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}
