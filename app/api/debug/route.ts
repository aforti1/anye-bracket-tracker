import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET() {
  // Get game_nodes for South and West R32 — show source_a/source_b
  const { data: nodes } = await supabase
    .from("game_nodes")
    .select("*")
    .in("round", ["round_32", "round_64"])
    .in("region", ["South", "West"])
    .order("game_idx");

  // Get first bracket picks
  const { data: bracket } = await supabase
    .from("brackets")
    .select("bracket_hash, picks")
    .limit(1)
    .single();

  const picks = typeof bracket?.picks === "string"
    ? bracket.picks.split(",").map(Number)
    : [];

  // For each R32 node, show what picks[source_a] and picks[source_b] resolve to
  const { data: teams } = await supabase.from("tournament_teams").select("*");
  const teamMap = new Map((teams ?? []).map((t: any) => [t.team_id, t.name]));

  const enriched = (nodes ?? []).map((n: any) => ({
    game_idx:   n.game_idx,
    round:      n.round,
    region:     n.region,
    team_a_id:  n.team_a_id,
    team_b_id:  n.team_b_id,
    source_a:   n.source_a,
    source_b:   n.source_b,
    // For R32: what teams does source resolve to?
    resolved_a: n.source_a != null ? `${picks[n.source_a]} (${teamMap.get(picks[n.source_a]) ?? "?"})` : null,
    resolved_b: n.source_b != null ? `${picks[n.source_b]} (${teamMap.get(picks[n.source_b]) ?? "?"})` : null,
  }));

  return NextResponse.json({ nodes: enriched, picks_sample: picks.slice(0, 35) });
}
