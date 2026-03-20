// app/api/womens/game-nodes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const revalidate = 300;

export async function GET() {
  const { data, error } = await supabase
    .from("w_game_nodes")
    .select("*")
    .order("game_idx");

  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}
