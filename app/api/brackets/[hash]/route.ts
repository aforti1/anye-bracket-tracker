import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import type { BracketDetail, PickDetail, TournamentTeam, GameNode, Round } from "@/lib/types";

export const dynamic = 'force-dynamic';

const ROUND_POINTS: Record<Round, number> = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { hash: string } }
) {
  const hash = params.hash.toUpperCase();

  const [bracketRes, nodesRes, teamsRes, resultsRes] = await Promise.all([
    supabase.from("brackets").select("*").eq("bracket_hash", hash).single(),
    supabase.from("game_nodes").select("*").order("game_idx"),
    supabase.from("tournament_teams").select("*"),
    supabase.from("game_results").select("*"),
  ]);

  if (bracketRes.error || !bracketRes.data) {
    return NextResponse.json({ error: "Bracket not found" }, { status: 404 });
  }
  const bracket = bracketRes.data;

  // Rank
  const { count: rankCount } = await supabase
    .from("brackets")
    .select("id", { count: "exact", head: true })
    .gt("total_points", bracket.total_points);
  const rank = (rankCount ?? 0) + 1;

  // Lookup maps
  const teamMap = new Map<number, TournamentTeam>(
    (teamsRes.data ?? []).map((t: TournamentTeam) => [t.team_id, t])
  );
  const resultMap = new Map<number, any>(
    (resultsRes.data ?? []).map((r: any) => [r.game_idx, r])
  );
  const nodeList = (nodesRes.data ?? []) as GameNode[];

  // Parse picks from CSV string
  const picks: number[] = typeof bracket.picks === "string" && bracket.picks.length > 0
    ? bracket.picks.split(",").map(Number)
    : [];

  // Build pick_details
  const pick_details: PickDetail[] = nodeList.map((node) => {
    const predicted_id   = picks[node.game_idx] ?? 0;
    const predicted_team = predicted_id > 0 ? (teamMap.get(predicted_id) ?? null) : null;
    const result         = resultMap.get(node.game_idx) ?? null;
    const actual_team    = result ? (teamMap.get(result.winner_id) ?? null) : null;

    let correct: boolean | null = null;
    let points = 0;
    if (result && predicted_id > 0) {
      correct = predicted_id === result.winner_id;
      if (correct) points = ROUND_POINTS[node.round as Round] ?? 0;
    }

    // R64: use team_a_id/team_b_id stored in game_nodes
    // Later rounds: resolve from picks of source games
    let team_a: TournamentTeam | null = null;
    let team_b: TournamentTeam | null = null;

    if (node.round === "round_64") {
      team_a = node.team_a_id ? (teamMap.get(node.team_a_id) ?? null) : null;
      team_b = node.team_b_id ? (teamMap.get(node.team_b_id) ?? null) : null;
    } else {
      const srcA = node.source_a != null ? (picks[node.source_a] ?? 0) : 0;
      const srcB = node.source_b != null ? (picks[node.source_b] ?? 0) : 0;
      team_a = srcA > 0 ? (teamMap.get(srcA) ?? null) : null;
      team_b = srcB > 0 ? (teamMap.get(srcB) ?? null) : null;
    }

    return {
      game_idx:         node.game_idx,
      round:            node.round as Round,
      region:           node.region,
      team_a,
      team_b,
      predicted_winner: predicted_team,
      actual_winner:    actual_team,
      correct,
      points,
    };
  });

  return NextResponse.json({ ...bracket, picks, rank, pick_details });
}
