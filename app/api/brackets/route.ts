// app/api/brackets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

const ROUND_POINTS: Record<string, number> = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const per_page    = Math.min(100, Math.max(10, parseInt(searchParams.get("per_page") ?? "50")));
  const sort        = searchParams.get("sort")        ?? "total_points";
  const order       = searchParams.get("order")       ?? "desc";
  const champion_id = searchParams.get("champion_id") ?? null;
  const min_upsets  = searchParams.get("min_upsets")  ?? null;
  const max_upsets  = searchParams.get("max_upsets")  ?? null;
  const pickFiltersRaw = searchParams.get("pick_filters") ?? null;

  const allowedSorts = ["bracket_hash","champion_name","total_points","correct_picks","accuracy","log_prob","upset_count","rank"];
  const sortCol = allowedSorts.includes(sort) ? sort : "total_points";
  const sortAsc = order === "asc";

  let pickConditions: { game_idx: number; team_id: number; won: boolean }[] = [];
  if (pickFiltersRaw) {
    try {
      const p = JSON.parse(pickFiltersRaw);
      if (Array.isArray(p)) pickConditions = p;
    } catch {}
  }

  // Load game structure (needed for enrichment: max_points, perfect_streak)
  const [nodesRes, resultsRes] = await Promise.all([
    supabase.from("game_nodes").select("*").order("game_idx"),
    supabase.from("game_results").select("game_idx, winner_id").order("game_idx"),
  ]);
  const gameNodes = nodesRes.data ?? [];
  const gameResults = resultsRes.data ?? [];
  const nodeMap = new Map(gameNodes.map(n => [n.game_idx, n]));
  const winnerByIdx = new Map(gameResults.map(r => [r.game_idx, r.winner_id]));
  const decidedIdxes = Array.from(winnerByIdx.keys()).sort((a, b) => a - b);
  const decidedSet = new Set(decidedIdxes);

  // Build set of eliminated teams from decided games
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

  const games_complete = gameResults.length;

  // Enrich a bracket row with computed fields (runs on page of results only)
  function enrichBracket(b: any) {
    const picks: number[] = typeof b.picks === "string"
      ? b.picks.split(",").map(Number)
      : (b.picks ?? []);
    // Per-bracket max_points: only count future games where picked team is still alive
    let max_points = b.total_points;
    for (const n of gameNodes) {
      if (!decidedSet.has(n.game_idx)) {
        const pickedTeam = picks[n.game_idx];
        if (pickedTeam && !eliminated.has(pickedTeam)) {
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
  }

  // ── PICK FILTER PATH (uses SQL RPC) ──
  if (pickConditions.length > 0) {
    // Build conditions with source_a/source_b for the "reached" check in SQL
    const conditionsWithSources = pickConditions.map(c => {
      const node = nodeMap.get(c.game_idx);
      return {
        game_idx: c.game_idx,
        team_id: c.team_id,
        won: c.won,
        source_a: node?.source_a ?? null,
        source_b: node?.source_b ?? null,
      };
    });

    const conditions = conditionsWithSources;

    const offset = (page - 1) * per_page;

    try {
      // Two parallel RPC calls: count + paginated results
      const [countRes, dataRes] = await Promise.all([
        supabase.rpc("count_filtered_brackets", {
          p_conditions: conditions,
          p_champion_id: champion_id ? parseInt(champion_id) : null,
          p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
          p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
        }),
        supabase.rpc("get_filtered_brackets", {
          p_conditions: conditions,
          p_champion_id: champion_id ? parseInt(champion_id) : null,
          p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
          p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
          p_sort_col: sortCol,
          p_sort_asc: sortAsc,
          p_offset: offset,
          p_limit: per_page,
        }),
      ]);

      if (countRes.error || dataRes.error) {
        throw new Error(countRes.error?.message ?? dataRes.error?.message ?? "RPC failed");
      }

      const total = Number(countRes.data ?? 0);
      // RPC doesn't return picks, so we need to fetch them for enrichment
      const ids = (dataRes.data ?? []).map((r: any) => r.id);
      let enriched = (dataRes.data ?? []).map((r: any) => ({
        ...r,
        max_points: 0, // Will be computed once picks are fetched below
        perfect_streak: 0,
      }));

      // If we need perfect_streak, fetch picks for just this page
      if (ids.length > 0 && decidedIdxes.length > 0) {
        const { data: picksData } = await supabase
          .from("brackets")
          .select("id, picks")
          .in("id", ids);

        if (picksData) {
          const picksMap = new Map(picksData.map((r: any) => [r.id, r.picks]));
          enriched = enriched.map((r: any) => {
            const rawPicks = picksMap.get(r.id);
            const picks: number[] = typeof rawPicks === "string"
              ? rawPicks.split(",").map(Number)
              : (rawPicks ?? []);
            let perfect_streak = 0;
            for (let i = decidedIdxes.length - 1; i >= 0; i--) {
              if (picks[decidedIdxes[i]] === winnerByIdx.get(decidedIdxes[i])) perfect_streak++;
              else break;
            }
            let max_points = r.total_points;
            for (const n of gameNodes) {
              if (!decidedSet.has(n.game_idx)) {
                const pt = picks[n.game_idx];
                if (pt && !eliminated.has(pt)) {
                  max_points += ROUND_POINTS[n.round] ?? 0;
                }
              }
            }
            return { ...r, max_points, perfect_streak };
          });
        }
      }

      // Sort by perfect_streak client-side if that's the sort column (can't do in SQL)
      if (sort === "perfect_streak") {
        enriched.sort((a: any, b: any) => {
          const d = (a.perfect_streak ?? 0) - (b.perfect_streak ?? 0);
          return order === "desc" ? -d : d;
        });
      }

      return NextResponse.json({
        brackets: enriched,
        total,
        page,
        per_page,
        total_pages: Math.ceil(total / per_page),
        games_complete,
        tournament_live: games_complete > 0 && games_complete < 63,
      });
    } catch (rpcError: any) {
      // Fallback to JS scan if RPC not deployed yet
      console.error("Pick filter RPC failed, falling back to JS scan:", rpcError.message);
      return jsPickFilterFallback(
        pickConditions, nodeMap, winnerByIdx, decidedIdxes, eliminated, gameNodes,
        champion_id, min_upsets, max_upsets, sortCol, sortAsc, sort, order,
        page, per_page, games_complete, enrichBracket
      );
    }
  }

  // ── NORMAL PATH (no pick filters — fast indexed query) ──
  const from2 = (page - 1) * per_page;
  const to2 = from2 + per_page - 1;

  let query = supabase.from("brackets")
    .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank", { count: "exact" })
    .order(sortCol, { ascending: sortAsc });

  if (champion_id) query = query.eq("champion_id", parseInt(champion_id));
  if (min_upsets)  query = query.gte("upset_count", parseInt(min_upsets));
  if (max_upsets)  query = query.lte("upset_count", parseInt(max_upsets));
  query = query.range(from2, to2);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let enriched = (data ?? []).map(enrichBracket);

  // Sort by computed columns client-side
  if (sort === "perfect_streak") {
    enriched.sort((a: any, b: any) => {
      const d = (a.perfect_streak ?? 0) - (b.perfect_streak ?? 0);
      return order === "desc" ? -d : d;
    });
  }

  return NextResponse.json({
    brackets: enriched,
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
    games_complete,
    tournament_live: games_complete > 0 && games_complete < 63,
  });
}

// ── JS FALLBACK for pick filtering (used if RPC not deployed) ──
async function jsPickFilterFallback(
  pickConditions: { game_idx: number; team_id: number; won: boolean }[],
  nodeMap: Map<number, any>,
  winnerByIdx: Map<number, number>,
  decidedIdxes: number[],
  eliminated: Set<number>,
  gameNodes: any[],
  champion_id: string | null,
  min_upsets: string | null,
  max_upsets: string | null,
  sortCol: string,
  sortAsc: boolean,
  sort: string,
  order: string,
  page: number,
  per_page: number,
  games_complete: number,
  enrichBracket: (b: any) => any,
) {
  function teamReachedGame(picks: number[], gi: number, tid: number): boolean {
    const n = nodeMap.get(gi);
    if (!n) return false;
    if (n.round === "round_64") return n.team_a_id === tid || n.team_b_id === tid;
    return (n.source_a != null && picks[n.source_a] === tid) || (n.source_b != null && picks[n.source_b] === tid);
  }

  function matchesAll(picks: number[]): boolean {
    return pickConditions.every(c => {
      if (c.won) return picks[c.game_idx] === c.team_id;
      return teamReachedGame(picks, c.game_idx, c.team_id) && picks[c.game_idx] !== c.team_id;
    });
  }

  const matchingRows = new Map<number, any>();
  const batchSize = 1000;
  let from = 0;

  while (true) {
    let q = supabase.from("brackets")
      .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank")
      .range(from, from + batchSize - 1)
      .order("id", { ascending: true });

    if (champion_id) q = q.eq("champion_id", parseInt(champion_id));
    if (min_upsets)  q = q.gte("upset_count", parseInt(min_upsets));
    if (max_upsets)  q = q.lte("upset_count", parseInt(max_upsets));

    const { data } = await q;
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (matchingRows.has(row.id)) continue;
      const picks: number[] = typeof row.picks === "string"
        ? row.picks.split(",").map(Number)
        : (row.picks ?? []);
      if (matchesAll(picks)) matchingRows.set(row.id, row);
    }

    if (data.length < batchSize) break;
    from += batchSize;
  }

  let allMatching = Array.from(matchingRows.values());
  const total = allMatching.length;

  if (total === 0) {
    return NextResponse.json({
      brackets: [], total: 0, page, per_page, total_pages: 0,
      games_complete, tournament_live: games_complete > 0 && games_complete < 63,
    });
  }

  let enriched = allMatching.map(enrichBracket);

  const sk = sort === "perfect_streak" ? "perfect_streak" : (sort === "max_points" ? "max_points" : sortCol);
  enriched.sort((a: any, b: any) => {
    const va = a[sk] ?? 0;
    const vb = b[sk] ?? 0;
    if (typeof va === "string" && typeof vb === "string")
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });

  const pageStart = (page - 1) * per_page;
  const pageRows = enriched.slice(pageStart, pageStart + per_page);

  return NextResponse.json({
    brackets: pageRows, total, page, per_page,
    total_pages: Math.ceil(total / per_page),
    games_complete, tournament_live: games_complete > 0 && games_complete < 63,
  });
}
