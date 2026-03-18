// app/api/brackets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import type { LeaderboardResponse } from "@/lib/types";

export const revalidate = 30; // revalidate every 30s

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const page        = Math.max(1, parseInt(searchParams.get("page")    ?? "1"));
  const per_page    = Math.min(100, Math.max(10, parseInt(searchParams.get("per_page") ?? "50")));
  const sort        = searchParams.get("sort")        ?? "total_points";
  const order       = searchParams.get("order")       ?? "desc";
  const champion_id = searchParams.get("champion_id") ?? null;
  const min_upsets  = searchParams.get("min_upsets")  ?? null;
  const max_upsets  = searchParams.get("max_upsets")  ?? null;

  const allowedSorts = ["bracket_hash", "champion_name", "total_points", "correct_picks", "accuracy", "log_prob", "upset_count", "rank"];
  const sortCol = allowedSorts.includes(sort) ? sort : "total_points";
  const sortAsc = order === "asc";

  const from = (page - 1) * per_page;
  const to   = from + per_page - 1;

  let query = supabase
    .from("brackets")
    .select(
      "id, bracket_hash, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank",
      { count: "exact" }
    )
    .order(sortCol, { ascending: sortAsc })
    .range(from, to);

  if (champion_id) query = query.eq("champion_id", parseInt(champion_id));
  if (min_upsets)  query = query.gte("upset_count", parseInt(min_upsets));
  if (max_upsets)  query = query.lte("upset_count", parseInt(max_upsets));

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get games completed from metadata
  const { data: meta } = await supabase
    .from("metadata")
    .select("value")
    .eq("key", "games_completed")
    .single();

  const games_complete    = parseInt(meta?.value ?? "0");
  const total             = count ?? 0;
  const total_pages       = Math.ceil(total / per_page);

  const response: LeaderboardResponse = {
    brackets: data ?? [],
    total,
    page,
    per_page,
    total_pages,
    games_complete,
    tournament_live: games_complete > 0 && games_complete < 63,
  };

  return NextResponse.json(response);
}
