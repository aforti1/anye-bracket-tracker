// app/womens/page.tsx
import { Suspense } from "react";
import { supabase } from "@/lib/db";
import LeaderboardClient from "@/components/LeaderboardClient";
import TournamentHeader from "@/components/TournamentHeader";
import type { TournamentSummary } from "@/lib/types";

export const revalidate = 30;

async function getSummary(): Promise<TournamentSummary> {
  const [metaRes, topRes, resultsRes] = await Promise.all([
    supabase.from("w_metadata").select("key, value"),
    supabase.from("w_brackets")
      .select("bracket_hash, total_points")
      .order("total_points", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("w_game_results").select("game_idx", { count: "exact" }),
  ]);

  const metaMap = new Map<string, string>(
    (metaRes.data ?? []).map((r: any) => [r.key, r.value])
  );
  const totalBrackets = parseInt(metaMap.get("total_brackets") ?? "0");
  const gamesCompleted = resultsRes.count ?? 0;
  const uniqueChampions = parseInt(metaMap.get("unique_champions") ?? "0");

  let perfectRemaining = 0;
  if (gamesCompleted > 0) {
    const { count } = await supabase
      .from("w_brackets")
      .select("id", { count: "exact", head: true })
      .eq("correct_picks", gamesCompleted);
    perfectRemaining = count ?? 0;
  } else {
    perfectRemaining = totalBrackets;
  }

  return {
    total_brackets: totalBrackets,
    games_completed: gamesCompleted,
    games_total: 63,
    top_score: topRes.data?.total_points ?? 0,
    top_bracket_hash: topRes.data?.bracket_hash ?? null,
    unique_champions: uniqueChampions,
    last_updated: metaMap.get("last_updated") ?? null,
    perfect_remaining: perfectRemaining,
  };
}

async function getChampionOptions() {
  const { data, error } = await supabase
    .from("w_champion_counts")
    .select("champion_id, champion_name, champion_seed, count")
    .order("count", { ascending: false });

  if (error) {
    console.error("w_champion_counts query failed:", error.message);
    return [];
  }

  return (data ?? []).map((r: any) => ({
    team_id: r.champion_id,
    name: r.champion_name ?? "Unknown",
    seed: r.champion_seed ?? 0,
    count: r.count,
  }));
}

export default async function WomensPage() {
  const [summary, champions] = await Promise.all([getSummary(), getChampionOptions()]);

  return (
    <main className="min-h-screen">
      <TournamentHeader summary={summary} gender="womens" />
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <Suspense fallback={<LeaderboardSkeleton />}>
          <LeaderboardClient
            summary={summary}
            champions={champions}
            apiBase="/api/womens"
            routeBase="/womens"
          />
        </Suspense>
      </div>
    </main>
  );
}

function LeaderboardSkeleton() {
  return <div className="card animate-pulse" style={{ minHeight: "calc(100vh - 280px)" }} />;
}
