// app/api/debug-cron/route.ts
// Temporary debug endpoint — call this manually to see what the cron sees.
// Visit: /api/debug-cron?secret=YOUR_CRON_SECRET
// Remove after debugging.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Load current state
  const [espnRes, existingRes, nodesRes, teamsRes, scoredLogRes, metaRes] =
    await Promise.all([
      fetch(ESPN_URL, { next: { revalidate: 0 } }),
      supabase.from("game_results").select("game_idx, winner_id, winner_name"),
      supabase.from("game_nodes").select("game_idx, round, team_a_id, team_b_id"),
      supabase.from("tournament_teams").select("team_id, name, seed"),
      supabase.from("scoring_log").select("game_idx"),
      supabase.from("metadata").select("key, value"),
    ]);

  const espnJson = await espnRes.json();
  const events = espnJson.events ?? [];
  const existingResults = existingRes.data ?? [];
  const recorded = new Set(existingResults.map((r: any) => r.game_idx));
  const teams = teamsRes.data ?? [];
  const dbNameToId = new Map(teams.map((t: any) => [t.name, t.team_id]));
  const scoredSet = new Set((scoredLogRes.data ?? []).map((r: any) => r.game_idx));
  const meta = Object.fromEntries((metaRes.data ?? []).map((r: any) => [r.key, r.value]));

  // Check for orphaned results (in game_results but not scoring_log)
  const orphaned = existingResults.filter((r: any) => !scoredSet.has(r.game_idx));

  // Check what ESPN currently shows
  const espnGames = events.map((e: any) => {
    const comp = e.competitions?.[0];
    const t1 = comp?.competitors?.[0]?.team?.displayName ?? "?";
    const t2 = comp?.competitors?.[1]?.team?.displayName ?? "?";
    const state = e.status?.type?.state;
    const completed = e.status?.type?.completed;
    const winner = comp?.competitors?.find((c: any) => c.winner)?.team?.displayName ?? null;

    // Try to resolve both teams
    const resolve = (name: string) => {
      // Check the ESPN_TO_DB map inline
      const map: Record<string, string> = {
        "LIU Sharks": "LIU Brooklyn",
        "UConn Huskies": "Connecticut",
        "St. John's Red Storm": "St John's",
        "Michigan State Spartans": "Michigan St",
        // ... (just testing a few key ones)
      };
      const dbName = map[name];
      if (dbName) return { dbName, id: dbNameToId.get(dbName) ?? null };
      const direct = dbNameToId.get(name);
      if (direct) return { dbName: name, id: direct };
      // Try stripping mascot
      const words = name.split(" ");
      for (let i = words.length - 1; i >= 1; i--) {
        const candidate = words.slice(0, i).join(" ");
        const match = dbNameToId.get(candidate);
        if (match) return { dbName: candidate, id: match };
      }
      return { dbName: null, id: null };
    };

    return {
      espn_team1: t1,
      espn_team2: t2,
      state,
      completed,
      winner,
      team1_resolved: resolve(t1),
      team2_resolved: resolve(t2),
    };
  });

  // Check bracket scoring state
  const { data: topBracket } = await supabase
    .from("brackets")
    .select("total_points, correct_picks, games_decided, rank")
    .order("total_points", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    metadata: meta,
    existing_results: existingResults.length,
    existing_results_detail: existingResults,
    scored_games: scoredLogRes.data?.length ?? 0,
    orphaned_count: orphaned.length,
    orphaned: orphaned.map((r: any) => r.game_idx),
    espn_games_count: espnGames.length,
    espn_games: espnGames,
    db_teams_count: teams.length,
    top_bracket: topBracket,
  });
}
