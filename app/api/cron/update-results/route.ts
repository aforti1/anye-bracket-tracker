// app/api/cron/update-results/route.ts
// Called by Vercel Cron every 15 minutes during tournament window.
// 1. Scrapes ESPN scoreboard for completed NCAA tournament games → scores brackets
// 2. Detects in-progress games → stores their game_idxs in metadata for live UI state

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";
import { ROUND_POINTS, type Round } from "@/lib/types";

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
  id: string;
  status: {
    type: {
      completed: boolean;
      state: string;       // "pre" | "in" | "post"
      description: string;
    };
  };
  competitions: Array<{
    competitors: Array<{
      id: string;
      winner: boolean;
      team: { displayName: string; id: string };
      score: string;
    }>;
    notes: Array<{ type: string; headline: string }>;
  }>;
}

// Try to match an ESPN game to one of our game_nodes by team names
function matchToNode(
  comp: ESPNGame["competitions"][0],
  nodes: any[],
  teamByName: Map<string, number>,
  recorded: Set<number>,
  skipRecorded: boolean,
): { node: any; teamAId: number; teamBId: number } | null {
  const teams = comp.competitors;
  if (teams.length < 2) return null;

  const id1 = teamByName.get(teams[0].team.displayName.toLowerCase());
  const id2 = teamByName.get(teams[1].team.displayName.toLowerCase());
  if (!id1 || !id2) return null;

  for (const node of nodes) {
    if (skipRecorded && recorded.has(node.game_idx)) continue;
    const nodeTeams = new Set([node.team_a_id, node.team_b_id].filter(Boolean));
    if (nodeTeams.has(id1) && nodeTeams.has(id2)) {
      return { node, teamAId: id1, teamBId: id2 };
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    // 1. Fetch ESPN scoreboard
    const res = await fetch(ESPN_URL, { next: { revalidate: 0 } });
    const json = await res.json();
    const events: ESPNGame[] = json.events ?? [];

    // 2. Load existing state
    const { data: existingResults } = await supabase
      .from("game_results")
      .select("game_idx");
    const recorded = new Set((existingResults ?? []).map((r: any) => r.game_idx));

    const { data: nodes } = await supabase
      .from("game_nodes")
      .select("game_idx, round, team_a_id, team_b_id");

    const { data: teams } = await supabase
      .from("tournament_teams")
      .select("team_id, name, seed");
    const teamByName = new Map<string, number>(
      (teams ?? []).map((t: any) => [t.name.toLowerCase(), t.team_id])
    );

    let newResults = 0;
    const liveGameIdxs: number[] = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      // ── COMPLETED GAMES: score brackets ──
      if (event.status.type.completed) {
        const winnerObj = comp.competitors?.find((c) => c.winner);
        if (!winnerObj) continue;

        const winnerName = winnerObj.team.displayName;
        const winnerId = teamByName.get(winnerName.toLowerCase());
        if (!winnerId) continue;

        const match = matchToNode(comp, nodes ?? [], teamByName, recorded, true);
        if (!match) continue;

        const roundName = comp.notes?.[0]?.headline ?? "";
        const round = ROUND_MAP[roundName] ?? match.node.round;
        const winnerSeed = (teams ?? []).find((t: any) => t.team_id === winnerId)?.seed ?? 0;

        const { error: insertErr } = await supabase.from("game_results").insert({
          game_idx: match.node.game_idx,
          winner_id: winnerId,
          winner_name: winnerName,
          winner_seed: winnerSeed,
          completed_at: new Date().toISOString(),
        });

        if (insertErr) {
          console.error(`Failed to insert game_idx ${match.node.game_idx}:`, insertErr.message);
          continue;
        }

        const roundPts = ROUND_POINTS[round as Round] ?? 0;
        await supabase.rpc("score_game", {
          p_game_idx: match.node.game_idx,
          p_winner_id: winnerId,
          p_points: roundPts,
        });

        recorded.add(match.node.game_idx);
        newResults++;
        continue;
      }

      // ── IN-PROGRESS GAMES: track for live UI state ──
      if (event.status.type.state === "in") {
        const match = matchToNode(comp, nodes ?? [], teamByName, recorded, true);
        if (match) {
          liveGameIdxs.push(match.node.game_idx);
        }
      }
    }

    // 3. Store live game indices in metadata (replace every run)
    await supabase.from("metadata").upsert({
      key: "live_game_idxs",
      value: JSON.stringify(liveGameIdxs),
    });

    // 4. Update general metadata
    const { count: gamesCompleted } = await supabase
      .from("game_results")
      .select("game_idx", { count: "exact" });

    await supabase.from("metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted ?? 0) },
      { key: "last_updated", value: new Date().toISOString() },
    ]);

    // 5. Update ranks if we scored new games
    if (newResults > 0) {
      await supabase.rpc("update_ranks");
    }

    return NextResponse.json({
      ok: true,
      new_results: newResults,
      live_games: liveGameIdxs.length,
      games_complete: gamesCompleted,
    });
  } catch (err: any) {
    console.error("Cron error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
