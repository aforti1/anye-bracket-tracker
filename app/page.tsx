// app/page.tsx
import { Suspense } from "react";
import { supabase } from "@/lib/db";
import LeaderboardClient from "@/components/LeaderboardClient";
import TournamentHeader from "@/components/TournamentHeader";
import type { TournamentSummary } from "@/lib/types";

export const revalidate = 30;

async function getSummary(): Promise<TournamentSummary> {
  const [metaRes, topRes, champRes, resultsRes] = await Promise.all([
    supabase.from("metadata").select("key, value"),
    supabase
      .from("brackets")
      .select("bracket_hash, total_points")
      .order("total_points", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("brackets").select("champion_id").not("champion_id", "is", null),
    supabase.from("game_results").select("game_idx", { count: "exact" }),
  ]);

  const metaMap = new Map<string, string>(
    (metaRes.data ?? []).map((r: any) => [r.key, r.value])
  );

  const uniqueChampions = new Set(
    (champRes.data ?? []).map((r: any) => r.champion_id)
  ).size;

  return {
    total_brackets:   parseInt(metaMap.get("total_brackets") ?? "0"),
    games_completed:  resultsRes.count ?? 0,
    games_total:      63,
    top_score:        topRes.data?.total_points ?? 0,
    top_bracket_hash: topRes.data?.bracket_hash ?? null,
    unique_champions: uniqueChampions,
    last_updated:     metaMap.get("last_updated") ?? null,
  };
}

async function getChampionOptions() {
  const { data } = await supabase
    .from("brackets")
    .select("champion_id, champion_name, champion_seed")
    .not("champion_id", "is", null)
    .order("champion_id");

  if (!data) return [];

  // Deduplicate by champion_id and count
  const counts = new Map<number, { name: string; seed: number; count: number }>();
  for (const row of data) {
    const existing = counts.get(row.champion_id);
    if (existing) {
      existing.count++;
    } else {
      counts.set(row.champion_id, {
        name:  row.champion_name ?? "Unknown",
        seed:  row.champion_seed ?? 0,
        count: 1,
      });
    }
  }

  return Array.from(counts.entries())
    .map(([id, v]) => ({ team_id: id, ...v }))
    .sort((a, b) => b.count - a.count);
}

export default async function HomePage() {
  const [summary, champions] = await Promise.all([
    getSummary(),
    getChampionOptions(),
  ]);

  return (
    <main className="min-h-screen">
      <TournamentHeader summary={summary} />

      <div className="max-w-7xl mx-auto px-4 pb-16">
        <Suspense fallback={<LeaderboardSkeleton />}>
          <LeaderboardClient summary={summary} champions={champions} />
        </Suspense>
      </div>
    </main>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="card animate-pulse" style={{ height: 600 }} />
  );
}
