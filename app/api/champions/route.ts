// app/api/champions/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const allData: { champion_id: number; champion_name: string; champion_seed: number }[] = [];
  const batchSize = 1000;
  let from = 0;

  while (true) {
    const { data } = await supabase
      .from("brackets")
      .select("champion_id, champion_name, champion_seed")
      .not("champion_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + batchSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const counts = new Map<number, { name: string; seed: number; count: number }>();
  for (const row of allData) {
    const existing = counts.get(row.champion_id);
    if (existing) existing.count++;
    else counts.set(row.champion_id, { name: row.champion_name ?? "Unknown", seed: row.champion_seed ?? 0, count: 1 });
  }

  return NextResponse.json(
    Array.from(counts.entries())
      .map(([id, v]) => ({ team_id: id, ...v }))
      .sort((a, b) => b.count - a.count)
  );
}
