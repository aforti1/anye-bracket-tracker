// lib/get-bracket-detail.ts
import { supabase } from "@/lib/db";
import { picksSourceMode } from "@/lib/picks-source";
import { getPicksForId } from "@/lib/picks-blob";
import type { BracketDetail, PickDetail, TournamentTeam, GameNode, Round } from "@/lib/types";

const ROUND_POINTS: Record<Round, number> = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

const BRACKET_COLS_NO_PICKS =
  "id, bracket_hash, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank, perfect_streak";

const TABLES = {
  mens: {
    brackets: "brackets",
    nodes: "game_nodes",
    teams: "tournament_teams",
    results: "game_results",
  },
  womens: {
    brackets: "w_brackets",
    nodes: "w_game_nodes",
    teams: "w_tournament_teams",
    results: "w_game_results",
  },
};

export type Gender = "mens" | "womens";

/**
 * Fetch a complete bracket detail (metadata + resolved picks + expanded pick_details).
 * Returns null if no bracket is found for the given hash.
 *
 * This is the single source of truth for bracket detail data. Both the
 * /api/[mens|womens]/brackets/[hash] routes AND the server-rendered detail
 * pages call this directly — no HTTP self-fetch.
 */
export async function getBracketDetail(
  hash: string,
  gender: Gender
): Promise<BracketDetail | null> {
  const t = TABLES[gender];
  const mode = picksSourceMode();
  const cols = mode === "blob" ? BRACKET_COLS_NO_PICKS : `${BRACKET_COLS_NO_PICKS}, picks`;

  const [bracketRes, nodesRes, teamsRes, resultsRes] = await Promise.all([
    supabase.from(t.brackets).select(cols).eq("bracket_hash", hash).single(),
    supabase.from(t.nodes).select("*").order("game_idx"),
    supabase.from(t.teams).select("*"),
    supabase.from(t.results).select("*"),
  ]);

  if (bracketRes.error || !bracketRes.data) return null;
  const bracket: any = bracketRes.data;
  const rank = bracket.rank ?? null;

  const teamMap = new Map<number, TournamentTeam>(
    (teamsRes.data ?? []).map((t: TournamentTeam) => [t.team_id, t])
  );
  const resultMap = new Map<number, any>(
    (resultsRes.data ?? []).map((r: any) => [r.game_idx, r])
  );
  const nodeList = (nodesRes.data ?? []) as GameNode[];

  let picks: number[];
  if (mode === "blob") {
    picks = await getPicksForId(bracket.id, gender);
  } else {
    picks = bracket.picks ?? [];
  }

  const pick_details: PickDetail[] = nodeList.map((node) => {
    const predicted_id = picks[node.game_idx] ?? 0;
    const predicted_team = predicted_id > 0 ? (teamMap.get(predicted_id) ?? null) : null;
    const result = resultMap.get(node.game_idx) ?? null;
    const actual_team = result ? (teamMap.get(result.winner_id) ?? null) : null;

    let correct: boolean | null = null;
    let points = 0;
    if (result && predicted_id > 0) {
      correct = predicted_id === result.winner_id;
      if (correct) points = ROUND_POINTS[node.round as Round] ?? 0;
    }

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
      game_idx: node.game_idx,
      round: node.round as Round,
      region: node.region,
      team_a,
      team_b,
      predicted_winner: predicted_team,
      actual_winner: actual_team,
      correct,
      points,
    };
  });

  const { picks: _stripped, ...bracketRest } = bracket;
  return { ...bracketRest, picks, rank, pick_details } as BracketDetail;
}