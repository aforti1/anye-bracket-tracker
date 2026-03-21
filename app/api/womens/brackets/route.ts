// app/api/womens/brackets/route.ts
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

  const [nodesRes, resultsRes] = await Promise.all([
    supabase.from("w_game_nodes").select("*").order("game_idx"),
    supabase.from("w_game_results").select("game_idx, winner_id, completed_at").order("completed_at"),
  ]);
  const gameNodes = nodesRes.data ?? [];
  const gameResults = resultsRes.data ?? [];
  const nodeMap = new Map(gameNodes.map(n => [n.game_idx, n]));
  const winnerByIdx = new Map(gameResults.map(r => [r.game_idx, r.winner_id]));
  const decidedIdxes = Array.from(winnerByIdx.keys()).sort((a, b) => a - b);
  const decidedSet = new Set(decidedIdxes);
  const decidedByTime = gameResults.map((r: any) => r.game_idx);

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

  // ── PICK FILTER PATH ──
  if (pickConditions.length > 0) {
    const conditionsWithSources = pickConditions.map(c => {
      const node = nodeMap.get(c.game_idx);
      return {
        game_idx: c.game_idx, team_id: c.team_id, won: c.won,
        source_a: node?.source_a ?? null, source_b: node?.source_b ?? null,
      };
    });

    const conditions = conditionsWithSources;
    const offset = (page - 1) * per_page;

    try {
      const [countRes, dataRes] = await Promise.all([
        supabase.rpc("w_count_filtered_brackets", {
          p_conditions: conditions,
          p_champion_id: champion_id ? parseInt(champion_id) : null,
          p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
          p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
        }),
        supabase.rpc("w_get_filtered_brackets", {
          p_conditions: conditions,
          p_champion_id: champion_id ? parseInt(champion_id) : null,
          p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
          p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
          p_sort_col: sortCol, p_sort_asc: sortAsc,
          p_offset: offset, p_limit: per_page,
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
          .from("w_brackets").select("id, picks").in("id", ids);

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
                if (pt && !eliminated.has(pt)) max_points += ROUND_POINTS[n.round] ?? 0;
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
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── STANDARD FILTER PATH ──
  if (champion_id || min_upsets || max_upsets) {
    const BATCH = 10000;
    let from = 0;
    const matchingRows = new Map<number, any>();

    while (true) {
      let q = supabase.from("w_brackets")
        .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank")
        .order(sortCol, { ascending: sortAsc })
        .range(from, from + BATCH - 1);

      if (champion_id) q = q.eq("champion_id", parseInt(champion_id));
      if (min_upsets) q = q.gte("upset_count", parseInt(min_upsets));
      if (max_upsets) q = q.lte("upset_count", parseInt(max_upsets));

      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;

      for (const row of data) matchingRows.set(row.id, row);
      if (data.length < BATCH) break;
      from += BATCH;
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
      const va = a[sk] ?? 0; const vb = b[sk] ?? 0;
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

  // ── NO FILTERS ──
  const { count: totalCount } = await supabase
    .from("w_brackets").select("id", { count: "exact", head: true });
  const total = totalCount ?? 0;
  const total_pages = Math.ceil(total / per_page);

  const from_idx = (page - 1) * per_page;
  const to_idx = from_idx + per_page - 1;

  const { data, error } = await supabase
    .from("w_brackets")
    .select("id, bracket_hash, picks, champion_id, champion_name, champion_seed, log_prob, upset_count, total_points, correct_picks, games_decided, accuracy, rank")
    .order(sortCol, { ascending: sortAsc })
    .range(from_idx, to_idx);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let enriched = (data ?? []).map(enrichBracket);

  return NextResponse.json({
    brackets: enriched, total, page, per_page, total_pages,
    games_complete, tournament_live: games_complete > 0 && games_complete < 63,
  });
}
