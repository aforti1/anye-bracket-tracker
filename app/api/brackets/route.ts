// app/api/brackets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

const ROUND_POINTS: Record<string, number> = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

export const dynamic = "force-dynamic";

// Tiebreaker-aware sort comparator
function tiebreakSort(a: any, b: any, sk: string, sortAsc: boolean): number {
  const va = a[sk] ?? 0;
  const vb = b[sk] ?? 0;
  if (typeof va === "string" && typeof vb === "string") {
    const cmp = va.localeCompare(vb);
    if (cmp !== 0) return sortAsc ? cmp : -cmp;
  } else {
    if (va !== vb) return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  }
  // Tiebreaker: correct_picks desc, then total_points desc
  const ca = a.correct_picks ?? 0, cb = b.correct_picks ?? 0;
  if (ca !== cb) return cb - ca;
  const pa = a.total_points ?? 0, pb = b.total_points ?? 0;
  if (pa !== pb) return pb - pa;
  return 0;
}

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

  const allowedSorts = ["bracket_hash","champion_name","total_points","correct_picks","accuracy","log_prob","upset_count","rank","max_points","perfect_streak"];
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
    supabase.from("game_results").select("game_idx, winner_id, completed_at").order("completed_at"),
  ]);
  const gameNodes = nodesRes.data ?? [];
  const gameResults = resultsRes.data ?? [];
  const nodeMap = new Map(gameNodes.map(n => [n.game_idx, n]));
  const winnerByIdx = new Map(gameResults.map(r => [r.game_idx, r.winner_id]));
  const decidedIdxes = Array.from(winnerByIdx.keys()).sort((a, b) => a - b);
  const decidedSet = new Set(decidedIdxes);
  // For streak: order by when games actually finished, not bracket tree position
  const decidedByTime = gameResults.map((r: any) => r.game_idx);

  // Build eliminated set: teams that lost a decided game
  const eliminated = new Set<number>();
  for (const gi of decidedIdxes) {
    const node = nodeMap.get(gi);
    if (!node) continue;
    const winner = winnerByIdx.get(gi)!;
    const participants: number[] = [];
    if (node.round === "round_64") {
      if (node.team_a_id) participants.push(node.team_a_id);
      if (node.team_b_id) participants.push(node.team_b_id);
    } else {
      if (node.source_a != null && winnerByIdx.has(node.source_a)) participants.push(winnerByIdx.get(node.source_a)!);
      if (node.source_b != null && winnerByIdx.has(node.source_b)) participants.push(winnerByIdx.get(node.source_b)!);
    }
    for (const p of participants) {
      if (p !== winner) eliminated.add(p);
    }
  }

  const games_complete = gameResults.length;

  // Enrich a bracket row with computed fields (runs on page of results only)
  function enrichBracket(b: any) {
    const picks: number[] = b.picks ?? [];
    let max_points = b.total_points;
    for (const n of gameNodes) {
      if (!decidedSet.has(n.game_idx)) {
        const picked = picks[n.game_idx];
        if (picked && !eliminated.has(picked)) {
          max_points += ROUND_POINTS[n.round] ?? 0;
        }
      }
    }
    let perfect_streak = 0;
    for (let i = decidedByTime.length - 1; i >= 0; i--) {
      if (picks[decidedByTime[i]] === winnerByIdx.get(decidedByTime[i])) perfect_streak++;
      else break;
    }
    const { picks: _, ...rest } = b;
    return { ...rest, max_points, perfect_streak };
  }

  // Helper: apply secondary sort to a Supabase query
  function applySort(query: any) {
    query = query.order(sortCol, { ascending: sortAsc });
    // Secondary sort so points matches rank ordering
    if (sortCol === "total_points" || sortCol === "rank" || sortCol === "max_points") {
      query = query.order("correct_picks", { ascending: false });
    }
    return query;
  }

  // ── PICK FILTER PATH (uses SQL RPC) ──
  if (pickConditions.length > 0) {
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
      const ids = (dataRes.data ?? []).map((r: any) => r.id);
      let enriched = (dataRes.data ?? []).map((r: any) => ({
        ...r, max_points: 0, perfect_streak: 0,
      }));

      if (ids.length > 0 && decidedByTime.length > 0) {
        const { data: picksData } = await supabase
          .from("brackets")
          .select("id, picks")
          .in("id", ids);

        if (picksData) {
          const picksMap = new Map(picksData.map((r: any) => [r.id, r.picks]));
          enriched = enriched.map((r: any) => {
            const picks: number[] = picksMap.get(r.id) ?? [];
            let perfect_streak = 0;
            for (let i = decidedByTime.length - 1; i >= 0; i--) {
              if (picks[decidedByTime[i]] === winnerByIdx.get(decidedByTime[i])) perfect_streak++;
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

      return NextResponse.json({
        brackets: enriched, total, page, per_page,
        total_pages: Math.ceil(total / per_page),
        games_complete, tournament_live: games_complete > 0 && games_complete < 63,
      });
    } catch (rpcError: any) {
      console.error("Pick filter RPC failed, falling back to JS scan:", rpcError.message);
      return jsPickFilterFallback(
        pickConditions, nodeMap, winnerByIdx, decidedByTime, eliminated, gameNodes,
        champion_id, min_upsets, max_upsets, sortCol, sortAsc, sort, order,
        page, per_page, games_complete, enrichBracket
      );
    }
  }

  // ── NORMAL PATH ──
  const from2 = (page - 1) * per_page;
  const to2 = from2 + per_page - 1;
  const hasAnyFilter = !!(champion_id || min_upsets || max_upsets);

  const selectFields = "id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank";

  let query = hasAnyFilter
    ? supabase.from("brackets").select(selectFields, { count: "exact" })
    : supabase.from("brackets").select(selectFields);

  // Apply primary + secondary sort
  query = applySort(query);

  if (champion_id) query = query.eq("champion_id", parseInt(champion_id));
  if (min_upsets)  query = query.gte("upset_count", parseInt(min_upsets));
  if (max_upsets)  query = query.lte("upset_count", parseInt(max_upsets));
  query = query.range(from2, to2);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let total: number;
  if (hasAnyFilter) {
    total = count ?? 0;
  } else {
    const { data: meta } = await supabase.from("metadata").select("value").eq("key", "total_brackets").single();
    total = parseInt(meta?.value ?? "0") || 1000000;
  }

  let enriched = (data ?? []).map(enrichBracket);

  return NextResponse.json({
    brackets: enriched, total, page, per_page,
    total_pages: Math.ceil(total / per_page),
    games_complete, tournament_live: games_complete > 0 && games_complete < 63,
  });
}

// ── JS FALLBACK for pick filtering ──
async function jsPickFilterFallback(
  pickConditions: { game_idx: number; team_id: number; won: boolean }[],
  nodeMap: Map<number, any>,
  winnerByIdx: Map<number, number>,
  decidedByTime: number[],
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
  const decidedSet = new Set(decidedByTime);

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
      const picks: number[] = row.picks ?? [];
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
  enriched.sort((a: any, b: any) => tiebreakSort(a, b, sk, sortAsc));

  const pageStart = (page - 1) * per_page;
  const pageRows = enriched.slice(pageStart, pageStart + per_page);

  return NextResponse.json({
    brackets: pageRows, total, page, per_page,
    total_pages: Math.ceil(total / per_page),
    games_complete, tournament_live: games_complete > 0 && games_complete < 63,
  });
}

// Tiebreaker-aware sort comparator (module-level for fallback access)
function tiebreakSort(a: any, b: any, sk: string, sortAsc: boolean): number {
  const va = a[sk] ?? 0;
  const vb = b[sk] ?? 0;
  if (typeof va === "string" && typeof vb === "string") {
    const cmp = va.localeCompare(vb);
    if (cmp !== 0) return sortAsc ? cmp : -cmp;
  } else {
    if (va !== vb) return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  }
  const ca = a.correct_picks ?? 0, cb = b.correct_picks ?? 0;
  if (ca !== cb) return cb - ca;
  const pa = a.total_points ?? 0, pb = b.total_points ?? 0;
  if (pa !== pb) return pb - pa;
  return 0;
}
