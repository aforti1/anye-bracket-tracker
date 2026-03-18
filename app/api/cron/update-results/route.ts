// app/api/cron/update-results/route.ts
// Called by Vercel Cron every 15 minutes during tournament window.
// Scrapes ESPN's public scoreboard for completed NCAA tournament games
// and updates game_results + bracket scores in Supabase.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";
import { ROUND_POINTS, type Round } from "@/lib/types";

// ESPN public API — no auth required
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100";

const ROUND_MAP: Record<string, Round> = {
  "First Four":   "round_64",
  "First Round":  "round_64",
  "Second Round": "round_32",
  "Sweet 16":     "sweet_16",
  "Elite Eight":  "elite_8",
  "Final Four":   "final_four",
  "Championship": "championship",
};

interface ESPNGame {
  id:          string;
  status:      { type: { completed: boolean; description: string } };
  competitions: Array<{
    competitors: Array<{
      id:     string;
      winner: boolean;
      team:   { displayName: string; id: string };
      score:  string;
    }>;
    notes: Array<{ type: string; headline: string }>;
  }>;
}

export async function GET(req: NextRequest) {
  // Validate cron secret to prevent unauthorized calls
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    // 1. Fetch ESPN scoreboard
    const res  = await fetch(ESPN_URL, { next: { revalidate: 0 } });
    const json = await res.json();
    const events: ESPNGame[] = json.events ?? [];

    // 2. Get completed games we haven't recorded yet
    const { data: existingResults } = await supabase
      .from("game_results")
      .select("game_idx");
    const recorded = new Set((existingResults ?? []).map((r: any) => r.game_idx));

    // 3. Get game_nodes to match ESPN games to our game_idx
    const { data: nodes } = await supabase
      .from("game_nodes")
      .select("game_idx, round, team_a_id, team_b_id");

    // 4. Get tournament teams for name → id matching
    const { data: teams } = await supabase
      .from("tournament_teams")
      .select("team_id, name");
    const teamByName = new Map<string, number>(
      (teams ?? []).map((t: any) => [t.name.toLowerCase(), t.team_id])
    );

    let newResults = 0;

    for (const event of events) {
      if (!event.status.type.completed) continue;

      const comp       = event.competitions?.[0];
      const winner_obj = comp?.competitors?.find((c) => c.winner);
      if (!winner_obj) continue;

      const winner_name = winner_obj.team.displayName;
      const winner_id   = teamByName.get(winner_name.toLowerCase());
      if (!winner_id) continue;

      // Match to a game node — find the node where winner_id is one of the teams
      const node = (nodes ?? []).find(
        (n: any) => n.team_a_id === winner_id || n.team_b_id === winner_id
      );
      if (!node || recorded.has(node.game_idx)) continue;

      // Insert result
      const { error: insertErr } = await supabase.from("game_results").insert({
        game_idx:    node.game_idx,
        winner_id,
        winner_name,
        winner_seed: 0, // enriched separately if needed
        completed_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error(`Failed to insert game_idx ${node.game_idx}:`, insertErr.message);
        continue;
      }

      // Score all brackets for this game
      const round_pts = ROUND_POINTS[node.round as Round] ?? 0;
      await supabase.rpc("score_game", {
        p_game_idx:  node.game_idx,
        p_winner_id: winner_id,
        p_points:    round_pts,
      });

      recorded.add(node.game_idx);
      newResults++;
    }

    // 5. Update metadata
    const { count: gamesCompleted } = await supabase
      .from("game_results")
      .select("game_idx", { count: "exact" });

    await supabase.from("metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted ?? 0) },
      { key: "last_updated",    value: new Date().toISOString() },
    ]);

    return NextResponse.json({
      ok:         true,
      new_results: newResults,
      games_complete: gamesCompleted,
    });
  } catch (err: any) {
    console.error("Cron error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
