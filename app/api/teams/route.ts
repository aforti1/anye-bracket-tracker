// app/api/teams/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const revalidate = 300;

export async function GET() {
  const { data, error } = await supabase
    .from("tournament_teams")
    .select("team_id, name, seed, region")
    .order("region, seed");

  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}
