// app/api/womens/champions/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("w_champion_counts")
    .select("champion_id, champion_name, champion_seed, count")
    .order("count", { ascending: false });

  if (error) {
    console.error("w_champion_counts query failed:", error.message);
    return NextResponse.json([]);
  }

  return NextResponse.json(
    (data ?? []).map((r: any) => ({
      team_id: r.champion_id,
      name: r.champion_name ?? "Unknown",
      seed: r.champion_seed ?? 0,
      count: r.count,
    }))
  );
}
