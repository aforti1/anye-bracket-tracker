// app/api/womens/summary/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
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

  return NextResponse.json({
    total_brackets: totalBrackets,
    games_completed: gamesCompleted,
    games_total: 63,
    top_score: topRes.data?.total_points ?? 0,
    top_bracket_hash: topRes.data?.bracket_hash ?? null,
    unique_champions: uniqueChampions,
    last_updated: metaMap.get("last_updated") ?? null,
    perfect_remaining: perfectRemaining,
  });
}
