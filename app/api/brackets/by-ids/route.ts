// app/api/brackets/by-ids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

const ROUND_POINTS: Record<string, number> = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: number[] = body.ids ?? [];

  if (ids.length === 0) {
    return NextResponse.json({ brackets: [] });
  }

  // Cap at 100 IDs per request
  const safeIds = ids.slice(0, 100);

  // Load game state for enrichment
  const [nodesRes, resultsRes] = await Promise.all([
    supabase.from("game_nodes").select("game_idx, round, team_a_id, team_b_id, source_a, source_b").order("game_idx"),
    supabase.from("game_results").select("game_idx, winner_id").order("game_idx"),
  ]);
  const gameNodes = nodesRes.data ?? [];
  const gameResults = resultsRes.data ?? [];
  const winnerByIdx = new Map(gameResults.map(r => [r.game_idx, r.winner_id]));
  const decidedIdxes = Array.from(winnerByIdx.keys()).sort((a, b) => a - b);
  const decidedSet = new Set(decidedIdxes);

  const nodeMap = new Map(gameNodes.map((n: any) => [n.game_idx, n]));
  const eliminated = new Set<number>();
  for (const gi of decidedIdxes) {
    const node = nodeMap.get(gi);
    if (!node) continue;
    const winner = winnerByIdx.get(gi)!;
    let participants: number[] = [];
    if (node.round === "round_64") {
      participants = [node.team_a_id, node.team_b_id].filter(Boolean);
    } else {
      if (node.source_a != null && winnerByIdx.has(node.source_a)) {
        participants.push(winnerByIdx.get(node.source_a)!);
      }
      if (node.source_b != null && winnerByIdx.has(node.source_b)) {
        participants.push(winnerByIdx.get(node.source_b)!);
      }
    }
    for (const p of participants) {
      if (p !== winner) eliminated.add(p);
    }
  }

  // Fetch the specific rows
  const { data, error } = await supabase
    .from("brackets")
    .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank")
    .in("id", safeIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich + preserve the order from the IDs array
  const rowMap = new Map((data ?? []).map(r => [r.id, r]));
  const enriched = safeIds
    .map(id => rowMap.get(id))
    .filter(Boolean)
    .map((b: any) => {
      const picks: number[] = typeof b.picks === "string"
        ? b.picks.split(",").map(Number)
        : (b.picks ?? []);
      let max_points = b.total_points;
      for (const n of gameNodes) {
        if (!decidedSet.has(n.game_idx)) {
          const pt = picks[n.game_idx];
          if (pt && !eliminated.has(pt)) {
            max_points += ROUND_POINTS[n.round] ?? 0;
          }
        }
      }
      let perfect_streak = 0;
      for (let i = decidedIdxes.length - 1; i >= 0; i--) {
        if (picks[decidedIdxes[i]] === winnerByIdx.get(decidedIdxes[i])) perfect_streak++;
        else break;
      }
      const { picks: _, ...rest } = b;
      return { ...rest, max_points, perfect_streak };
    });

  return NextResponse.json({ brackets: enriched });
}
