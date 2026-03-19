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
  if (pickFiltersRaw) { try { const p = JSON.parse(pickFiltersRaw); if (Array.isArray(p)) pickConditions = p; } catch {} }

  // Load game structure (needed for enrichment + pick filter "reached" logic)
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
  let remainingPointsSum = 0;
  for (const n of gameNodes) if (!decidedSet.has(n.game_idx)) remainingPointsSum += ROUND_POINTS[n.round] ?? 0;
  const games_complete = gameResults.length;

  // Structural teams cache (for "reached" check)
  const structuralCache = new Map<number, Set<number>>();
  function getStructural(gi: number): Set<number> {
    if (structuralCache.has(gi)) return structuralCache.get(gi)!;
    const n = nodeMap.get(gi);
    if (!n) return new Set();
    if (n.round === "round_64") {
      const s = new Set<number>();
      if (n.team_a_id) s.add(n.team_a_id);
      if (n.team_b_id) s.add(n.team_b_id);
      structuralCache.set(gi, s); return s;
    }
    const s = new Set<number>();
    if (n.source_a != null) for (const id of getStructural(n.source_a)) s.add(id);
    if (n.source_b != null) for (const id of getStructural(n.source_b)) s.add(id);
    structuralCache.set(gi, s); return s;
  }

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

  function enrichBracket(b: any) {
    let picks: number[] = typeof b.picks === "string" ? b.picks.split(",").map(Number) : (b.picks ?? []);
    const max_points = b.total_points + remainingPointsSum;
    let perfect_streak = 0;
    for (let i = decidedIdxes.length - 1; i >= 0; i--) {
      if (picks[decidedIdxes[i]] === winnerByIdx.get(decidedIdxes[i])) perfect_streak++; else break;
    }
    const { picks: _, ...rest } = b;
    return { ...rest, max_points, perfect_streak };
  }

  // ── PICK FILTER PATH ──
  if (pickConditions.length > 0) {
    // Scan ALL brackets in one pass, collecting matching IDs
    // Use a Map to deduplicate and store the full row
    const matchingRows = new Map<number, any>();
    const batchSize = 1000;
    let from = 0;

    while (true) {
      let q = supabase.from("brackets")
        .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank")
        .range(from, from + batchSize - 1)
        .order("id", { ascending: true }); // deterministic ordering for pagination

      if (champion_id) q = q.eq("champion_id", parseInt(champion_id));
      if (min_upsets) q = q.gte("upset_count", parseInt(min_upsets));
      if (max_upsets) q = q.lte("upset_count", parseInt(max_upsets));

      const { data } = await q;
      if (!data || data.length === 0) break;

      for (const row of data) {
        if (matchingRows.has(row.id)) continue; // dedup
        const picks: number[] = typeof row.picks === "string" ? row.picks.split(",").map(Number) : (row.picks ?? []);
        if (matchesAll(picks)) matchingRows.set(row.id, row);
      }

      if (data.length < batchSize) break;
      from += batchSize;
    }

    let allMatching = Array.from(matchingRows.values());
    const total = allMatching.length;

    if (total === 0) {
      return NextResponse.json({ brackets: [], total: 0, page, per_page, total_pages: 0, games_complete, tournament_live: games_complete > 0 && games_complete < 63 });
    }

    // Enrich all
    let enriched = allMatching.map(enrichBracket);

    // Sort
    const sk = sort === "perfect_streak" ? "perfect_streak" : (sort === "max_points" ? "max_points" : sortCol);
    enriched.sort((a, b) => {
      const va = a[sk] ?? 0;
      const vb = b[sk] ?? 0;
      if (typeof va === "string" && typeof vb === "string") return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
    });

    // Paginate
    const pageStart = (page - 1) * per_page;
    const pageRows = enriched.slice(pageStart, pageStart + per_page);

    return NextResponse.json({
      brackets: pageRows, total, page, per_page,
      total_pages: Math.ceil(total / per_page),
      games_complete, tournament_live: games_complete > 0 && games_complete < 63,
    });
  }

  // ── NORMAL PATH ──
  const from2 = (page - 1) * per_page;
  const to2 = from2 + per_page - 1;

  let query = supabase.from("brackets")
    .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank", { count: "exact" })
    .order(sortCol, { ascending: sortAsc });

  if (champion_id) query = query.eq("champion_id", parseInt(champion_id));
  if (min_upsets) query = query.gte("upset_count", parseInt(min_upsets));
  if (max_upsets) query = query.lte("upset_count", parseInt(max_upsets));
  query = query.range(from2, to2);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let enriched = (data ?? []).map(enrichBracket);
  if (sort === "perfect_streak") {
    enriched.sort((a: any, b: any) => { const d = (a.perfect_streak ?? 0) - (b.perfect_streak ?? 0); return order === "desc" ? -d : d; });
  }

  return NextResponse.json({
    brackets: enriched, total: count ?? 0, page, per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
    games_complete, tournament_live: games_complete > 0 && games_complete < 63,
  });
}
