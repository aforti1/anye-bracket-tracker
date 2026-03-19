// app/api/summary/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import type { TournamentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

async function countUniqueChampions(): Promise<number> {
  const ids = new Set<number>();
  const batchSize = 1000;
  let from = 0;

  while (true) {
    const { data } = await supabase
      .from("brackets")
      .select("champion_id")
      .not("champion_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + batchSize - 1);

    if (!data || data.length === 0) break;
    for (const row of data) ids.add(row.champion_id);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  return ids.size;
}

export async function GET() {
  const [metaRes, topRes, resultsRes] = await Promise.all([
    supabase.from("metadata").select("key, value"),
    supabase.from("brackets").select("bracket_hash, total_points").order("total_points", { ascending: false }).limit(1).single(),
    supabase.from("game_results").select("game_idx", { count: "exact" }),
  ]);

  const metaMap = new Map<string, string>((metaRes.data ?? []).map((r: any) => [r.key, r.value]));
  const totalBrackets = parseInt(metaMap.get("total_brackets") ?? "0");
  const gamesCompleted = resultsRes.count ?? 0;
  const uniqueChampions = await countUniqueChampions();

  let perfectRemaining = 0;
  if (gamesCompleted > 0) {
    const { count } = await supabase.from("brackets").select("id", { count: "exact", head: true }).eq("correct_picks", gamesCompleted);
    perfectRemaining = count ?? 0;
  } else {
    perfectRemaining = totalBrackets;
  }

  const summary: TournamentSummary = {
    total_brackets: totalBrackets, games_completed: gamesCompleted, games_total: 63,
    top_score: topRes.data?.total_points ?? 0, top_bracket_hash: topRes.data?.bracket_hash ?? null,
    unique_champions: uniqueChampions, last_updated: metaMap.get("last_updated") ?? null,
    perfect_remaining: perfectRemaining,
  };

  return NextResponse.json(summary);
}
