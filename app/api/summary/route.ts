// app/api/summary/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import type { TournamentSummary } from "@/lib/types";

export const revalidate = 30;

export async function GET() {
  const [metaRes, topRes, champRes, resultsRes, perfectRes] = await Promise.all([
    supabase.from("metadata").select("key, value"),
    supabase
      .from("brackets")
      .select("bracket_hash, total_points")
      .order("total_points", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("brackets").select("champion_id").not("champion_id", "is", null),
    supabase.from("game_results").select("game_idx", { count: "exact" }),
    // Perfect bracket = correct_picks equals games_decided for every game decided so far
    supabase
      .from("brackets")
      .select("id", { count: "exact" })
      .filter("correct_picks", "eq", supabase.from("brackets").select("games_decided")),
  ]);

  // Simpler perfect bracket count: correct_picks = games_decided (all correct so far)
  const { count: perfectCount } = await supabase
    .from("brackets")
    .select("id", { count: "exact", head: true })
    .gt("games_decided", 0)
    .filter("correct_picks", "gte", 1);

  // Actually compute properly: brackets where correct_picks = games_decided
  const gamesCompleted = resultsRes.count ?? 0;
  let perfectRemaining: number | null = null;

  if (gamesCompleted > 0) {
    const { count } = await supabase
      .from("brackets")
      .select("id", { count: "exact", head: true })
      .eq("correct_picks", gamesCompleted);
    perfectRemaining = count ?? 0;
  } else {
    // Before tournament starts, all brackets are "perfect" (no games decided)
    const metaMap = new Map<string, string>(
      (metaRes.data ?? []).map((r: any) => [r.key, r.value])
    );
    perfectRemaining = parseInt(metaMap.get("total_brackets") ?? "0");
  }

  const metaMap = new Map<string, string>(
    (metaRes.data ?? []).map((r: any) => [r.key, r.value])
  );

  const uniqueChampions = new Set(
    (champRes.data ?? []).map((r: any) => r.champion_id)
  ).size;

  const summary: TournamentSummary = {
    total_brackets:    parseInt(metaMap.get("total_brackets") ?? "0"),
    games_completed:   gamesCompleted,
    games_total:       63,
    top_score:         topRes.data?.total_points ?? 0,
    top_bracket_hash:  topRes.data?.bracket_hash ?? null,
    unique_champions:  uniqueChampions,
    last_updated:      metaMap.get("last_updated") ?? null,
    perfect_remaining: perfectRemaining,
  };

  return NextResponse.json(summary);
}
