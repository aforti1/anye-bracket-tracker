// app/womens/brackets/[hash]/page.tsx
import { notFound } from "next/navigation";
import BracketView from "@/components/BracketView";
import type { RegionLayout } from "@/components/BracketView";
import BackLink from "@/components/BackLink";
import type { BracketDetail } from "@/lib/types";
import { formatAccuracy } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Women's bracket layout:
// Top left: West → "Region 1"    Top right: Midwest → "Region 2"
// Bottom left: East → "Region 4" Bottom right: South → "Region 3"
const WOMENS_LAYOUT: RegionLayout = {
  topLeft:     { dataRegion: "West",    displayName: "Region 1" },
  bottomLeft:  { dataRegion: "East",    displayName: "Region 4" },
  topRight:    { dataRegion: "Midwest", displayName: "Region 2" },
  bottomRight: { dataRegion: "South",   displayName: "Region 3" },
};

function smartNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    if (Math.round(k) >= 1000) return "1M";
    if (k >= 100) return `${Math.round(k)}K`;
    if (k >= 10) return `${parseFloat((Math.round(k * 10) / 10).toFixed(1))}K`;
    return `${parseFloat((Math.round(k * 100) / 100).toFixed(2))}K`;
  }
  const m = n / 1_000_000;
  if (m >= 100) return `${Math.round(m)}M`;
  if (m >= 10) return `${parseFloat((Math.round(m * 10) / 10).toFixed(1))}M`;
  return `${parseFloat((Math.round(m * 100) / 100).toFixed(2))}M`;
}

function formatRank(rank: number | null): string {
  if (rank === null) return "—";
  return smartNum(rank);
}

async function getBracket(hash: string): Promise<BracketDetail | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/womens/brackets/${hash}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default async function WomensBracketPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const bracket = await getBracket(hash.toUpperCase());
  if (!bracket) notFound();

  const accuracy = formatAccuracy(bracket.correct_picks, bracket.games_decided);
  const rankStr  = formatRank(bracket.rank);

  return (
    <main className="min-h-screen">
      <div style={{ borderBottom: "1px solid var(--border)", marginBottom: 32 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
          <BackLink fallback="/womens" label="WOMEN'S LEADERBOARD" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, letterSpacing: "-0.01em", color: "#a855f7" }}>{bracket.bracket_hash}</h1>
              {bracket.rank && bracket.rank <= 100 && <span className="tag tag-correct" style={{ fontSize: 12 }}>TOP 100</span>}
            </div>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <MiniStat label="Score" value={String(bracket.total_points)} accent />
              <MiniStat label="Accuracy" value={accuracy} />
              <MiniStat label="Rank" value={rankStr} />
              <MiniStat label="Champion" value={bracket.champion_name ?? "—"} />
              <MiniStat label="Upsets" value={String(bracket.upset_count)} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 16px 48px" }}>
        <BracketView
          bracket={bracket}
          liveGamesUrl="/api/womens/live-games"
          regionLayout={WOMENS_LAYOUT}
          swapFinalFour
        />
      </div>
    </main>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: accent ? "#a855f7" : "var(--text-primary)", marginTop: 2 }}>{value}</div>
    </div>
  );
}
