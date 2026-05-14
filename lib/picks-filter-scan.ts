// lib/picks-filter-scan.ts
//
// Replacement for the Supabase {get,count}_filtered_brackets RPCs when
// PICKS_SOURCE=blob.
//
// Strategy: stream candidate ids from Supabase in the requested sort order
// (with the non-pick filters — champion_id / upset bounds — applied at SQL),
// and for each row evaluate the pick predicates against the picks file
// loaded from Vercel Blob. Sort order is preserved naturally because the
// pick predicate is just a row-level filter that drops rows; surviving rows
// remain in Supabase order.
//
// Semantics MUST match the existing RPC. The reference behavior is the JS
// fallback in app/api/brackets/route.ts (jsPickFilterFallback):
//
//   for each condition c in conditions:
//     if c.won === true:  bracket matches iff picks[c.game_idx] === c.team_id
//     if c.won === false: bracket matches iff teamReachedGame(picks, c.game_idx, c.team_id)
//                         AND picks[c.game_idx] !== c.team_id
//
//   teamReachedGame(picks, game_idx, team_id):
//     for round_64: node.team_a_id === team_id || node.team_b_id === team_id
//     otherwise:    picks[node.source_a] === team_id || picks[node.source_b] === team_id
//
// All conditions are AND-ed. Champion + upset filters are AND-ed on top.
//
// Cold-start cost: first call after a function instance goes cold pays the
// 126 MB blob download. Warm calls are ~1 second total for a full 1M scan.

import { supabase } from "@/lib/db";
import { getPicksScanner, type Gender } from "@/lib/picks-blob";

const SORT_COL_MAP: Record<string, string> = {
  // max_points isn't a real column. In archival mode the tournament is
  // finalized so max_points == total_points, which IS a column.
  max_points: "total_points",
};

type PickCondition = {
  game_idx: number;
  team_id: number;
  won: boolean;
};

type GameNode = {
  game_idx: number;
  round: string;
  team_a_id: number | null;
  team_b_id: number | null;
  source_a: number | null;
  source_b: number | null;
};

export interface ScanArgs {
  conditions: PickCondition[];
  champion_id: number | null;
  min_upsets: number | null;
  max_upsets: number | null;
  sort_col: string;
  sort_asc: boolean;
  // Pre-loaded game_nodes map. Routes already fetch this; we accept it to
  // avoid re-querying.
  nodeMap: Map<number, GameNode>;
}

export async function scanFilteredIds(gender: Gender, args: ScanArgs): Promise<number[]> {
  const tableName = gender === "mens" ? "brackets" : "w_brackets";
  const scanner = await getPicksScanner(gender);

  const orderCol = SORT_COL_MAP[args.sort_col] ?? args.sort_col;

  // Resolve participants for each pick condition once. For round_64 the
  // participants come from node.team_a_id/team_b_id; for later rounds they
  // come from picks[source_a]/picks[source_b] (so they're per-bracket).
  type ResolvedCond = {
    game_idx: number;
    team_id: number;
    won: boolean;
    isR64: boolean;
    r64TeamA: number | null;
    r64TeamB: number | null;
    source_a: number | null;
    source_b: number | null;
  };
  const resolved: ResolvedCond[] = args.conditions.map(c => {
    const node = args.nodeMap.get(c.game_idx);
    const isR64 = node?.round === "round_64";
    return {
      game_idx: c.game_idx,
      team_id: c.team_id,
      won: c.won,
      isR64,
      r64TeamA: node?.team_a_id ?? null,
      r64TeamB: node?.team_b_id ?? null,
      source_a: node?.source_a ?? null,
      source_b: node?.source_b ?? null,
    };
  });

  // Per-row predicate. Returns true iff ALL conditions match.
  function matches(id: number): boolean {
    for (const c of resolved) {
      const pickAtGame = scanner.pickAt(id, c.game_idx);
      if (c.won) {
        if (pickAtGame !== c.team_id) return false;
        continue;
      }
      // !c.won — team must have REACHED the game and LOST it.
      if (pickAtGame === c.team_id) return false;
      let reached = false;
      if (c.isR64) {
        reached = c.r64TeamA === c.team_id || c.r64TeamB === c.team_id;
      } else {
        const a = c.source_a != null ? scanner.pickAt(id, c.source_a) : 0;
        const b = c.source_b != null ? scanner.pickAt(id, c.source_b) : 0;
        reached = a === c.team_id || b === c.team_id;
      }
      if (!reached) return false;
    }
    return true;
  }

  // Stream id+sort-context from Supabase in sorted order with non-pick
  // filters applied. We only fetch `id` (and the sort column if it's needed
  // for tiebreak — but Supabase already orders, we just preserve the
  // returned order).
  const BATCH = 50000;
  const matched: number[] = [];
  let from = 0;

  while (true) {
    let q: any = supabase.from(tableName).select("id");
    q = q.order(orderCol, { ascending: args.sort_asc });
    // Mirror the secondary sort that the leaderboard route applies for
    // stable cross-RPC ordering.
    if (orderCol !== "bracket_hash") {
      if (orderCol !== "total_points") q = q.order("total_points", { ascending: false });
      if (orderCol !== "correct_picks") q = q.order("correct_picks", { ascending: false });
    }
    if (args.champion_id != null) q = q.eq("champion_id", args.champion_id);
    if (args.min_upsets  != null) q = q.gte("upset_count", args.min_upsets);
    if (args.max_upsets  != null) q = q.lte("upset_count", args.max_upsets);
    q = q.range(from, from + BATCH - 1);

    const { data, error } = await q;
    if (error) throw new Error(`scanFilteredIds: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const id = (row as any).id as number;
      if (id < 1 || id > scanner.recordCount) continue;
      if (matches(id)) matched.push(id);
    }

    if (data.length < BATCH) break;
    from += BATCH;
  }

  return matched;
}
