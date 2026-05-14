// app/api/brackets/filter-ids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { picksSourceMode } from "@/lib/picks-source";
import { scanFilteredIds } from "@/lib/picks-filter-scan";

export const dynamic = "force-dynamic";

const ALLOWED_SORTS = ["bracket_hash","champion_name","total_points","correct_picks","accuracy","log_prob","upset_count","rank","max_points","perfect_streak"];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const champion_id    = searchParams.get("champion_id") ?? null;
  const min_upsets     = searchParams.get("min_upsets") ?? null;
  const max_upsets     = searchParams.get("max_upsets") ?? null;
  const pickFiltersRaw = searchParams.get("pick_filters") ?? null;
  const sort           = searchParams.get("sort") ?? "total_points";
  const order          = searchParams.get("order") ?? "desc";

  const sortCol = ALLOWED_SORTS.includes(sort) ? sort : "total_points";
  const sortAsc = order === "asc";
  const mode = picksSourceMode();

  let parsedConditions: { game_idx: number; team_id: number; won: boolean }[] | null = null;
  if (pickFiltersRaw) {
    try {
      const parsed = JSON.parse(pickFiltersRaw);
      if (Array.isArray(parsed) && parsed.length > 0) parsedConditions = parsed;
    } catch {}
  }

  if (mode === "blob") {
    if (!parsedConditions) {
      // No pick conditions — defer to RPC for ordering or just return empty.
      // Existing client only hits this route when pickFilters is non-empty
      // OR other filters are set; either way the RPC handles it. Match by
      // querying Supabase directly for the id list.
      let q: any = supabase.from("brackets").select("id");
      const sortMapped = sortCol === "max_points" ? "total_points" : sortCol;
      q = q.order(sortMapped, { ascending: sortAsc });
      if (sortMapped !== "bracket_hash") {
        if (sortMapped !== "total_points") q = q.order("total_points", { ascending: false });
        if (sortMapped !== "correct_picks") q = q.order("correct_picks", { ascending: false });
      }
      if (champion_id) q = q.eq("champion_id", parseInt(champion_id));
      if (min_upsets)  q = q.gte("upset_count", parseInt(min_upsets));
      if (max_upsets)  q = q.lte("upset_count", parseInt(max_upsets));
      // Stream all in batches.
      const ids: number[] = [];
      const BATCH = 50000;
      let from = 0;
      while (true) {
        const { data, error } = await q.range(from, from + BATCH - 1);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data || data.length === 0) break;
        for (const r of data) ids.push((r as any).id);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return NextResponse.json({ ids, total: ids.length });
    }

    try {
      const { data: nodesData } = await supabase
        .from("game_nodes")
        .select("game_idx, round, team_a_id, team_b_id, source_a, source_b")
        .order("game_idx");
      const nodeMap = new Map((nodesData ?? []).map((n: any) => [n.game_idx, n]));

      const ids = await scanFilteredIds("mens", {
        conditions: parsedConditions,
        champion_id: champion_id ? parseInt(champion_id) : null,
        min_upsets: min_upsets ? parseInt(min_upsets) : null,
        max_upsets: max_upsets ? parseInt(max_upsets) : null,
        sort_col: sortCol,
        sort_asc: sortAsc,
        nodeMap,
      });
      return NextResponse.json({ ids, total: ids.length });
    } catch (err: any) {
      console.error("blob filter scan failed:", err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Supabase mode (legacy RPC path) ──
  let conditions: any[] | null = null;
  if (parsedConditions) {
    const { data: nodesData } = await supabase
      .from("game_nodes")
      .select("game_idx, source_a, source_b, round")
      .order("game_idx");
    const nodeMap = new Map((nodesData ?? []).map(n => [n.game_idx, n]));
    conditions = parsedConditions.map((c: any) => {
      const node = nodeMap.get(c.game_idx);
      return {
        game_idx: c.game_idx,
        team_id: c.team_id,
        won: c.won,
        source_a: node?.source_a ?? null,
        source_b: node?.source_b ?? null,
      };
    });
  }

  const { data, error } = await supabase.rpc("get_filtered_bracket_ids", {
    p_conditions: conditions,
    p_champion_id: champion_id ? parseInt(champion_id) : null,
    p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
    p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
    p_sort_col: sortCol,
    p_sort_asc: sortAsc,
  }).limit(1000000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((r: any) => r.id);
  return NextResponse.json({ ids, total: ids.length });
}
