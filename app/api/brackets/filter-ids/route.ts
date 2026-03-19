// app/api/brackets/filter-ids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const champion_id    = searchParams.get("champion_id") ?? null;
  const min_upsets     = searchParams.get("min_upsets") ?? null;
  const max_upsets     = searchParams.get("max_upsets") ?? null;
  const pickFiltersRaw = searchParams.get("pick_filters") ?? null;

  let conditions: any[] | null = null;
  if (pickFiltersRaw) {
    try {
      const parsed = JSON.parse(pickFiltersRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Load game nodes for source_a/source_b
        const { data: nodesData } = await supabase
          .from("game_nodes")
          .select("game_idx, source_a, source_b, round")
          .order("game_idx");
        const nodeMap = new Map((nodesData ?? []).map(n => [n.game_idx, n]));

        conditions = parsed.map((c: any) => {
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
    } catch {}
  }

  // Call the RPC that returns ALL matching IDs, sorted by total_points DESC
  const { data, error } = await supabase.rpc("get_filtered_bracket_ids", {
    p_conditions: conditions,
    p_champion_id: champion_id ? parseInt(champion_id) : null,
    p_min_upsets: min_upsets ? parseInt(min_upsets) : null,
    p_max_upsets: max_upsets ? parseInt(max_upsets) : null,
  }).limit(1000000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return just the IDs array
  const ids = (data ?? []).map((r: any) => r.id);
  return NextResponse.json({ ids, total: ids.length });
}
