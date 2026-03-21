// app/api/womens/live-games/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data } = await supabase
    .from("w_metadata")
    .select("value")
    .eq("key", "live_game_idxs")
    .single();

  let idxs: number[] = [];
  try {
    idxs = JSON.parse(data?.value ?? "[]");
  } catch {}

  return NextResponse.json({ live_game_idxs: idxs });
}
