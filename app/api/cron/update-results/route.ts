// app/api/cron/update-results/route.ts
//
// DESIGN PRINCIPLE: No single DB operation touches all 1M rows.
// Scoring is batched by ID range (~100K per call).
// Ranks are batched by score group (~10 calls).
// If anything fails mid-run, the next run picks up where it left off.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";
import { ROUND_POINTS, type Round } from "@/lib/types";

export const maxDuration = 120; // Vercel Pro max

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100";

const BATCH_SIZE = 100_000; // rows per score_game_batch call

const ROUND_MAP: Record<string, Round> = {
  "First Four":   "round_64",
  "First Round":  "round_64",
  "Second Round": "round_32",
  "Sweet 16":     "sweet_16",
  "Elite Eight":  "elite_8",
  "Final Four":   "final_four",
  "Championship": "championship",
};

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
    type: { completed: boolean; state: string; description: string };
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

function resolveESPN(name: string, map: Map<string, number>): number | undefined {
  const dbName = ESPN_TO_DB[name];
  return dbName ? map.get(dbName) : undefined;
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
    const s = new Set([node.team_a_id, node.team_b_id].filter(Boolean));
    if (s.has(id1) && s.has(id2)) return { node, teamAId: id1, teamBId: id2 };
  }
  return null;
}

function parseRoundFromNotes(notes: { type: string; headline: string }[]): string {
  const headline = notes?.[0]?.headline ?? "";
  const parts = headline.split(" - ");
  const roundPart = parts[parts.length - 1]?.trim() ?? "";
  return ({ "1st Round": "First Round", "2nd Round": "Second Round" } as any)[roundPart] ?? roundPart;
}

// ────────────────────────────────────────────────────────────────────────
// Batched scoring: score one game across all brackets in 100K chunks
// ────────────────────────────────────────────────────────────────────────
async function scoreGameBatched(
  supabase: ReturnType<typeof getServiceClient>,
  gameIdx: number,
  winnerId: number,
  points: number,
  minId: number,
  maxId: number,
  debugLog: string[],
): Promise<boolean> {
  let from = minId;
  let batchNum = 0;

  while (from <= maxId) {
    const to = from + BATCH_SIZE;
    const { error } = await supabase.rpc("score_game_batch", {
      p_game_idx: gameIdx,
      p_winner_id: winnerId,
      p_points: points,
      p_id_from: from,
      p_id_to: to,
    });

    if (error) {
      debugLog.push(`SCORE BATCH FAIL game_idx=${gameIdx} range=${from}-${to}: ${error.message}`);
      return false;
    }
    batchNum++;
    from = to;
  }

  // Log the scoring event
  await supabase.from("scoring_log").insert({
    game_idx: gameIdx,
    winner_id: winnerId,
    brackets_scored: maxId - minId + 1,
    scored_at: new Date().toISOString(),
  });

  debugLog.push(`SCORED game_idx ${gameIdx}: ${points} pts (${batchNum} batches)`);
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// Batched rank update: one UPDATE per score group
// ────────────────────────────────────────────────────────────────────────
async function updateRanksBatched(
  supabase: ReturnType<typeof getServiceClient>,
  debugLog: string[],
) {
  const { data: groups, error } = await supabase.rpc("get_score_groups");
  if (error || !groups) {
    debugLog.push(`RANKS FAIL: ${error?.message ?? "no data"}`);
    return;
  }

  let runningRank = 1;
  for (const g of groups) {
    await supabase
      .from("brackets")
      .update({ rank: runningRank })
      .eq("total_points", g.total_points)
      .eq("correct_picks", g.correct_picks);
    runningRank += Number(g.cnt);
  }

  debugLog.push(`RANKS: ${groups.length} groups, positions 1–${runningRank - 1}`);
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
  const startTime = Date.now();

  try {
    // ── Load state ──
    const [espnRes, existingRes, nodesRes, teamsRes, idRangeRes, scoredLogRes] =
      await Promise.all([
        fetch(ESPN_URL, { next: { revalidate: 0 } }),
        supabase.from("game_results").select("game_idx, winner_id"),
        supabase.from("game_nodes").select("game_idx, round, team_a_id, team_b_id"),
        supabase.from("tournament_teams").select("team_id, name, seed"),
        supabase.rpc("get_bracket_id_range"),
        supabase.from("scoring_log").select("game_idx"),
      ]);

    const espnJson = await espnRes.json();
    const events: ESPNGame[] = espnJson.events ?? [];

    const existingResults = existingRes.data ?? [];
    const recorded = new Set(existingResults.map((r: any) => r.game_idx));
    const nodes = nodesRes.data ?? [];
    const teams = teamsRes.data ?? [];
    const nodeRoundMap = new Map(nodes.map((n: any) => [n.game_idx, n.round]));
    const dbNameToId = new Map(teams.map((t: any) => [t.name, t.team_id]));
    const scoredSet = new Set((scoredLogRes.data ?? []).map((r: any) => r.game_idx));

    const idRange = idRangeRes.data?.[0] ?? idRangeRes.data;
    const minId = idRange?.min_id ?? 0;
    const maxId = idRange?.max_id ?? 0;

    let newResults = 0;
    const liveGameIdxs: number[] = [];
    const debugLog: string[] = [];

    // ── STEP 1: Reconcile orphaned games (inserted but never scored) ──
    const orphaned = existingResults.filter((r: any) => !scoredSet.has(r.game_idx));

    for (const orphan of orphaned) {
      // Time check: leave at least 40s for ESPN processing + ranks
      if (Date.now() - startTime > 70_000) {
        debugLog.push(`RECONCILE PAUSE: ${orphaned.length - newResults} games left, will continue next run`);
        break;
      }

      const round = nodeRoundMap.get(orphan.game_idx) as string;
      const pts = ROUND_POINTS[round as Round] ?? 0;
      const ok = await scoreGameBatched(supabase, orphan.game_idx, orphan.winner_id, pts, minId, maxId, debugLog);
      if (ok) newResults++;
    }

    // ── STEP 2: Process ESPN events (new completed games + live tracking) ──
    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const espnTeam1 = comp.competitors?.[0]?.team?.displayName ?? "?";
      const espnTeam2 = comp.competitors?.[1]?.team?.displayName ?? "?";

      if (event.status.type.completed) {
        const winnerObj = comp.competitors?.find((c) => c.winner);
        if (!winnerObj) { debugLog.push(`SKIP ${espnTeam1} vs ${espnTeam2}: no winner`); continue; }

        const winnerName = winnerObj.team.displayName;
        const winnerId = resolveESPN(winnerName, dbNameToId);
        if (!winnerId) { debugLog.push(`SKIP ${winnerName}: not in ESPN_TO_DB map`); continue; }

        const match = matchToNode(comp, nodes, dbNameToId, recorded, true);
        if (!match) { debugLog.push(`SKIP ${espnTeam1} vs ${espnTeam2}: no node match or already recorded`); continue; }

        // Time check
        if (Date.now() - startTime > 70_000) {
          debugLog.push(`TIME LIMIT: deferring new game scoring to next run`);
          break;
        }

        const roundStr = parseRoundFromNotes(comp.notes ?? []);
        const round = ROUND_MAP[roundStr] ?? match.node.round;
        const winnerSeed = teams.find((t: any) => t.team_id === winnerId)?.seed ?? 0;

        // Insert game result
        const { error: insertErr } = await supabase.from("game_results").insert({
          game_idx: match.node.game_idx,
          winner_id: winnerId,
          winner_name: winnerName,
          winner_seed: winnerSeed,
          completed_at: new Date().toISOString(),
        });
        if (insertErr) { debugLog.push(`ERROR game_idx ${match.node.game_idx}: ${insertErr.message}`); continue; }

        // Score in batches
        const roundPts = ROUND_POINTS[round as Round] ?? 0;
        const ok = await scoreGameBatched(supabase, match.node.game_idx, winnerId, roundPts, minId, maxId, debugLog);
        if (ok) {
          recorded.add(match.node.game_idx);
          newResults++;
        }
        continue;
      }

      if (event.status.type.state === "in") {
        const match = matchToNode(comp, nodes, dbNameToId, recorded, true);
        if (match) {
          liveGameIdxs.push(match.node.game_idx);
          debugLog.push(`LIVE game_idx ${match.node.game_idx}: ${espnTeam1} vs ${espnTeam2}`);
        }
      }
    }

    // ── STEP 3: Update metadata ──
    await supabase.from("metadata").upsert({
      key: "live_game_idxs",
      value: JSON.stringify(liveGameIdxs),
    });

    const { count: gamesCompleted } = await supabase
      .from("game_results")
      .select("game_idx", { count: "exact" });

    await supabase.from("metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted ?? 0) },
      { key: "last_updated", value: new Date().toISOString() },
    ]);

    // ── STEP 4: Update ranks (only if something was scored) ──
    if (newResults > 0) {
      await updateRanksBatched(supabase, debugLog);
    }

    debugLog.push(`DONE: ${Date.now() - startTime}ms, ${newResults} games scored`);

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