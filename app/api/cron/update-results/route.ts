// app/api/cron/update-results/route.ts
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

// Hardcoded ESPN displayName → DB team name
const ESPN_TO_DB: Record<string, string> = {
  "Duke Blue Devils":             "Duke",
  "UConn Huskies":                "Connecticut",
  "Michigan State Spartans":      "Michigan St",
  "Kansas Jayhawks":              "Kansas",
  "St. John's Red Storm":         "St John's",
  "Louisville Cardinals":         "Louisville",
  "UCLA Bruins":                  "UCLA",
  "Ohio State Buckeyes":          "Ohio St",
  "TCU Horned Frogs":             "TCU",
  "UCF Knights":                  "UCF",
  "South Florida Bulls":          "South Florida",
  "Northern Iowa Panthers":       "Northern Iowa",
  "California Baptist Lancers":   "Cal Baptist",
  "North Dakota State Bison":     "N Dakota St",
  "Furman Paladins":              "Furman",
  "Siena Saints":                 "Siena",
  "Michigan Wolverines":          "Michigan",
  "Iowa State Cyclones":          "Iowa St",
  "Virginia Cavaliers":           "Virginia",
  "Alabama Crimson Tide":         "Alabama",
  "Texas Tech Red Raiders":       "Texas Tech",
  "Tennessee Volunteers":         "Tennessee",
  "Kentucky Wildcats":            "Kentucky",
  "Georgia Bulldogs":             "Georgia",
  "Saint Louis Billikens":        "St Louis",
  "Santa Clara Broncos":          "Santa Clara",
  "Miami (OH) RedHawks":          "Miami OH",
  "Akron Zips":                   "Akron",
  "Hofstra Pride":                "Hofstra",
  "Wright State Raiders":         "Wright St",
  "Tennessee State Tigers":       "Tennessee St",
  "Howard Bison":                 "Howard",
  "Florida Gators":               "Florida",
  "Houston Cougars":              "Houston",
  "Illinois Fighting Illini":     "Illinois",
  "Nebraska Cornhuskers":         "Nebraska",
  "Vanderbilt Commodores":        "Vanderbilt",
  "North Carolina Tar Heels":     "North Carolina",
  "Saint Mary's Gaels":           "St Mary's CA",
  "Clemson Tigers":               "Clemson",
  "Iowa Hawkeyes":                "Iowa",
  "Texas A&M Aggies":             "Texas A&M",
  "VCU Rams":                     "VCU",
  "McNeese Cowboys":              "McNeese St",
  "Troy Trojans":                 "Troy",
  "Pennsylvania Quakers":         "Penn",
  "Idaho Vandals":                "Idaho",
  "Prairie View A&M Panthers":    "Prairie View",
  "Arizona Wildcats":             "Arizona",
  "Purdue Boilermakers":          "Purdue",
  "Gonzaga Bulldogs":             "Gonzaga",
  "Arkansas Razorbacks":          "Arkansas",
  "Wisconsin Badgers":            "Wisconsin",
  "BYU Cougars":                  "BYU",
  "Miami Hurricanes":             "Miami FL",
  "Villanova Wildcats":           "Villanova",
  "Utah State Aggies":            "Utah St",
  "Missouri Tigers":              "Missouri",
  "Texas Longhorns":              "Texas",
  "High Point Panthers":          "High Point",
  "Hawai'i Rainbow Warriors":     "Hawaii",
  "Kennesaw State Owls":          "Kennesaw",
  "Queens Royals":                "Queens NC",
  "LIU Sharks":                   "LIU Brooklyn",
  "NC State Wolfpack":            "NC State",
};

interface ESPNGame {
  id: string;
  status: {
    type: {
      completed: boolean;
      state: string;
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

function resolveESPN(espnDisplayName: string, dbNameToId: Map<string, number>): number | undefined {
  const dbName = ESPN_TO_DB[espnDisplayName];
  if (dbName) return dbNameToId.get(dbName);
  return undefined;
}

function matchToNode(
  comp: ESPNGame["competitions"][0],
  nodes: any[],
  dbNameToId: Map<string, number>,
  recorded: Set<number>,
  skipRecorded: boolean,
): { node: any; teamAId: number; teamBId: number } | null {
  const teams = comp.competitors;
  if (teams.length < 2) return null;

  const id1 = resolveESPN(teams[0].team.displayName, dbNameToId);
  const id2 = resolveESPN(teams[1].team.displayName, dbNameToId);
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

function parseRoundFromNotes(notes: { type: string; headline: string }[]): string {
  const headline = notes?.[0]?.headline ?? "";
  const parts = headline.split(" - ");
  const roundPart = parts[parts.length - 1]?.trim() ?? "";
  const espnRoundMap: Record<string, string> = {
    "1st Round": "First Round",
    "2nd Round": "Second Round",
  };
  return espnRoundMap[roundPart] ?? roundPart;
}

// Allow up to 120s for rank updates on Vercel Pro
export const maxDuration = 120;

// ────────────────────────────────────────────────────────────────────────
// Batched rank update — no massive self-joins, no timeouts
// ────────────────────────────────────────────────────────────────────────
async function updateRanksBatched(supabase: ReturnType<typeof getServiceClient>, debugLog: string[]) {
  // Step 1: get score groups via RPC (tiny query — just a GROUP BY)
  const { data: groups, error: groupErr } = await supabase.rpc("get_score_groups");

  if (groupErr || !groups) {
    debugLog.push(`RANKS: get_score_groups failed: ${groupErr?.message ?? "no data"}`);
    return;
  }

  // Step 2: compute rank for each group and update
  let runningRank = 1;
  let updatedGroups = 0;

  for (const g of groups) {
    const { error: updateErr } = await supabase
      .from("brackets")
      .update({ rank: runningRank })
      .eq("total_points", g.total_points)
      .eq("correct_picks", g.correct_picks);

    if (updateErr) {
      debugLog.push(`RANKS: update failed for pts=${g.total_points}, correct=${g.correct_picks}: ${updateErr.message}`);
    } else {
      updatedGroups++;
    }

    runningRank += Number(g.cnt);
  }

  debugLog.push(`RANKS: updated ${updatedGroups} score groups, final rank position: ${runningRank - 1}`);
}

// ────────────────────────────────────────────────────────────────────────
// Main cron handler
// ────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const res = await fetch(ESPN_URL, { next: { revalidate: 0 } });
    const json = await res.json();
    const events: ESPNGame[] = json.events ?? [];

    const { data: existingResults } = await supabase
      .from("game_results")
      .select("game_idx, winner_id");
    const recorded = new Set((existingResults ?? []).map((r: any) => r.game_idx));

    const { data: nodes } = await supabase
      .from("game_nodes")
      .select("game_idx, round, team_a_id, team_b_id");

    const nodeRoundMap = new Map<number, string>(
      (nodes ?? []).map((n: any) => [n.game_idx, n.round])
    );

    const { data: teams } = await supabase
      .from("tournament_teams")
      .select("team_id, name, seed");

    const dbNameToId = new Map<string, number>(
      (teams ?? []).map((t: any) => [t.name, t.team_id])
    );

    let newResults = 0;
    const liveGameIdxs: number[] = [];
    const debugLog: string[] = [];

    // ── RECONCILIATION: catch games inserted but never scored ──
    // Compare game_results count against games_decided on brackets.
    // If they don't match, find and score the orphaned games.
    const { data: sampleBracket } = await supabase
      .from("brackets")
      .select("games_decided")
      .limit(1)
      .single();

    const gamesDecided = sampleBracket?.games_decided ?? 0;
    const gamesRecorded = recorded.size;

    if (gamesRecorded > gamesDecided) {
      // Find which games were actually scored via scoring_log
      const { data: scoredLog } = await supabase
        .from("scoring_log")
        .select("game_idx");
      const scoredSet = new Set((scoredLog ?? []).map((r: any) => r.game_idx));

      // Score every game_result that's missing from scoring_log
      const orphaned = (existingResults ?? []).filter(
        (r: any) => !scoredSet.has(r.game_idx)
      );

      for (const orphan of orphaned) {
        const round = nodeRoundMap.get(orphan.game_idx);
        const roundPts = ROUND_POINTS[round as Round] ?? 0;
        await supabase.rpc("score_game", {
          p_game_idx: orphan.game_idx,
          p_winner_id: orphan.winner_id,
          p_points: roundPts,
        });
        debugLog.push(`RECONCILED game_idx ${orphan.game_idx}: scored ${roundPts} pts (was orphaned)`);
        newResults++;
      }

      if (orphaned.length > 0) {
        debugLog.push(`RECONCILIATION: scored ${orphaned.length} orphaned games`);
      }
    }

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const espnTeam1 = comp.competitors?.[0]?.team?.displayName ?? "?";
      const espnTeam2 = comp.competitors?.[1]?.team?.displayName ?? "?";

      if (event.status.type.completed) {
        const winnerObj = comp.competitors?.find((c) => c.winner);
        if (!winnerObj) {
          debugLog.push(`SKIP ${espnTeam1} vs ${espnTeam2}: no winner`);
          continue;
        }

        const winnerName = winnerObj.team.displayName;
        const winnerId = resolveESPN(winnerName, dbNameToId);
        if (!winnerId) {
          debugLog.push(`SKIP ${winnerName}: not in ESPN_TO_DB map`);
          continue;
        }

        const match = matchToNode(comp, nodes ?? [], dbNameToId, recorded, true);
        if (!match) {
          debugLog.push(`SKIP ${espnTeam1} vs ${espnTeam2}: no node match or already recorded`);
          continue;
        }

        const roundStr = parseRoundFromNotes(comp.notes ?? []);
        const round = ROUND_MAP[roundStr] ?? match.node.round;
        const winnerSeed = (teams ?? []).find((t: any) => t.team_id === winnerId)?.seed ?? 0;

        const { error: insertErr } = await supabase.from("game_results").insert({
          game_idx: match.node.game_idx,
          winner_id: winnerId,
          winner_name: winnerName,
          winner_seed: winnerSeed,
          completed_at: new Date().toISOString(),
        });

        if (insertErr) {
          debugLog.push(`ERROR game_idx ${match.node.game_idx}: ${insertErr.message}`);
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
        debugLog.push(`SCORED game_idx ${match.node.game_idx}: ${winnerName} (${roundPts} pts)`);
        continue;
      }

      if (event.status.type.state === "in") {
        const match = matchToNode(comp, nodes ?? [], dbNameToId, recorded, true);
        if (match) {
          liveGameIdxs.push(match.node.game_idx);
          debugLog.push(`LIVE game_idx ${match.node.game_idx}: ${espnTeam1} vs ${espnTeam2}`);
        } else {
          debugLog.push(`LIVE SKIP ${espnTeam1} vs ${espnTeam2}: no match`);
        }
      }
    }

    // ── Update live game tracking ──
    await supabase.from("metadata").upsert({
      key: "live_game_idxs",
      value: JSON.stringify(liveGameIdxs),
    });

    // ── Count total games completed ──
    const { count: gamesCompleted } = await supabase
      .from("game_results")
      .select("game_idx", { count: "exact" });

    await supabase.from("metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted ?? 0) },
      { key: "last_updated", value: new Date().toISOString() },
    ]);

    // ── Post-scoring updates (only if new games were scored) ──
    if (newResults > 0) {
      // 1. Ranks — batched by score group, no self-joins
      await updateRanksBatched(supabase, debugLog);

      // 2. Max points & perfect streak — both computed on-the-fly by
      //    the /api/brackets enrichBracket function for each displayed page.
      //    Max points is per-bracket (depends on which picked teams are
      //    still alive), so it can't be a simple DB UPDATE.
      debugLog.push(`MAX_POINTS + STREAK: computed on-the-fly by API`);
    }

    return NextResponse.json({
      ok: true,
      new_results: newResults,
      live_games: liveGameIdxs.length,
      games_complete: gamesCompleted,
      debug: debugLog,
    });
  } catch (err: any) {
    console.error("Cron error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
