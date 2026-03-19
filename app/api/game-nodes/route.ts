// app/api/game-nodes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const revalidate = 300; // cache 5 min — structure doesn't change during tournament

export async function GET() {
  const { data, error } = await supabase
    .from("game_nodes")
    .select("game_idx, round, region, slot, team_a_id, team_b_id, source_a, source_b")
    .order("game_idx");

  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}
