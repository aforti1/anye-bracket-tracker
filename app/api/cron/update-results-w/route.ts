// app/api/cron/update-results-w/route.ts
//
// Women's tournament auto-scraper with batched scoring.
// Uses w_score_game_range to process 50K rows at a time.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";
import { ROUND_POINTS, type Round } from "@/lib/types";

export const maxDuration = 120;

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?groups=100&limit=100";

const BATCH_SIZE = 50000;

const ROUND_MAP: Record<string, Round> = {
  "First Four": "round_64", "First Round": "round_64",
  "Second Round": "round_32", "Sweet 16": "sweet_16",
  "Elite Eight": "elite_8", "Final Four": "final_four",
  "Championship": "championship",
};

const ESPN_TO_DB: Record<string, string> = {
  // ── Confirmed from ESPN API (all 64 Round of 64 teams) ──
  "UConn Huskies":                  "Connecticut",
  "South Carolina Gamecocks":       "South Carolina",
  "UCLA Bruins":                    "UCLA",
  "Texas Longhorns":                "Texas",
  "LSU Tigers":                     "LSU",
  "Notre Dame Fighting Irish":      "Notre Dame",
  "Duke Blue Devils":               "Duke",
  "USC Trojans":                    "USC",
  "Ohio State Buckeyes":            "Ohio St",
  "Iowa State Cyclones":            "Iowa St",
  "Michigan State Spartans":        "Michigan St",
  "NC State Wolfpack":              "NC State",
  "Oklahoma Sooners":               "Oklahoma",
  "Nebraska Cornhuskers":           "Nebraska",
  "North Carolina Tar Heels":       "North Carolina",
  "Tennessee Lady Volunteers":      "Tennessee",
  "Kentucky Wildcats":              "Kentucky",
  "Alabama Crimson Tide":           "Alabama",
  "Maryland Terrapins":             "Maryland",
  "Baylor Bears":                   "Baylor",
  "Georgia Lady Bulldogs":          "Georgia",
  "Gonzaga Bulldogs":               "Gonzaga",
  "Michigan Wolverines":            "Michigan",
  "Iowa Hawkeyes":                  "Iowa",
  "Oregon Ducks":                   "Oregon",
  "Colorado Buffaloes":             "Colorado",
  "Louisville Cardinals":           "Louisville",
  "Villanova Wildcats":             "Villanova",
  "West Virginia Mountaineers":     "West Virginia",
  "Oklahoma State Cowgirls":        "Oklahoma St",
  "TCU Horned Frogs":               "TCU",
  "Vanderbilt Commodores":          "Vanderbilt",
  "Virginia Tech Hokies":           "Virginia Tech",
  "Illinois Fighting Illini":       "Illinois",
  "Clemson Tigers":                 "Clemson",
  "Washington Huskies":             "Washington",
  "Ole Miss Rebels":                "Mississippi",
  "High Point Panthers":            "High Point",
  "Princeton Tigers":               "Princeton",
  "Syracuse Orange":                "Syracuse",
  "Virginia Cavaliers":             "Virginia",
  "Minnesota Golden Gophers":       "Minnesota",
  "Howard Bison":                   "Howard",
  "Idaho Vandals":                  "Idaho",
  "Rhode Island Rams":              "Rhode Island",
  "Fairfield Stags":                "Fairfield",
  "Holy Cross Crusaders":           "Holy Cross",
  "Jacksonville Dolphins":          "Jacksonville",
  "James Madison Dukes":            "James Madison",
  "Vermont Catamounts":             "Vermont",
  "Texas Tech Lady Raiders":        "Texas Tech",
  "UC San Diego Tritons":           "UC San Diego",
  // ── Teams that won't resolve via mascot stripping ──
  "Arizona State Sun Devils":       "Arizona St",
  "California Baptist Lancers":     "Cal Baptist",
  "Charleston Cougars":             "Col Charleston",
  "Colorado State Rams":            "Colorado St",
  "Fairleigh Dickinson Knights":    "F Dickinson",
  "Green Bay Phoenix":              "WI Green Bay",
  "Miami (OH) RedHawks":            "Miami OH",
  "Missouri State Lady Bears":      "Missouri St",
  "Murray State Racers":            "Murray St",
  "South Dakota State Jackrabbits": "S Dakota St",
  "Southern Jaguars":               "Southern Univ",
  "UTSA Roadrunners":               "UT San Antonio",
  "Western Illinois Leathernecks":  "W Illinois",
};

interface ESPNGame {
  id: string;
  status: { type: { completed: boolean; state: string; description: string } };
  competitions: Array<{
    competitors: Array<{
      id: string; winner: boolean;
      team: { displayName: string; id: string }; score: string;
    }>;
    notes: Array<{ type: string; headline: string }>;
  }>;
}

function resolveESPN(name: string, map: Map<string, number>): number | undefined {
  const dbName = ESPN_TO_DB[name];
  if (dbName) return map.get(dbName);
  const direct = map.get(name);
  if (direct) return direct;
  const words = name.split(" ");
  if (words.length >= 2) {
    for (let i = words.length - 1; i >= 1; i--) {
      const candidate = words.slice(0, i).join(" ");
      const match = map.get(candidate);
      if (match) return match;
    }
  }
  return undefined;
}

function matchToNode(
  comp: ESPNGame["competitions"][0], nodes: any[],
  dbNameToId: Map<string, number>, recorded: Set<number>, skipRecorded: boolean,
): { node: any; teamAId: number; teamBId: number } | null {
  const t = comp.competitors;
  if (t.length < 2) return null;
  const id1 = resolveESPN(t[0].team.displayName, dbNameToId);
  const id2 = resolveESPN(t[1].team.displayName, dbNameToId);
  if (!id1 || !id2) return null;
  for (const node of nodes) {
    if (skipRecorded && recorded.has(node.game_idx)) continue;
    const s = new Set([node.team_a_id, node.team_b_id].filter(Boolean));
    if (s.has(id1) && s.has(id2)) return { node, teamAId: id1, teamBId: id2 };
  }
  return null;
}

function parseRoundFromNotes(notes: { type: string; headline: string }[]): string {
  const h = notes?.[0]?.headline ?? "";
  const p = h.split(" - ");
  const r = p[p.length - 1]?.trim() ?? "";
  return ({ "1st Round": "First Round", "2nd Round": "Second Round" } as any)[r] ?? r;
}

async function scoreBatched(
  supabase: ReturnType<typeof getServiceClient>,
  gameIdx: number, winnerId: number, points: number,
  minId: number, maxId: number, debugLog: string[],
): Promise<boolean> {
  let totalAffected = 0;
  let batchErrors = 0;

  for (let start = minId; start <= maxId; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE;
    const { data, error } = await supabase.rpc("w_score_game_range", {
      p_game_idx: gameIdx,
      p_winner_id: winnerId,
      p_points: points,
      p_min_id: start,
      p_max_id: end,
    });
    if (error) {
      debugLog.push(`W_BATCH FAIL ${start}-${end}: ${error.message}`);
      batchErrors++;
    } else {
      totalAffected += (data ?? 0);
    }
  }

  debugLog.push(`W_SCORED game_idx ${gameIdx}: ${totalAffected} rows, ${batchErrors} errors`);

  await supabase.from("w_scoring_log").insert({
    game_idx: gameIdx, winner_id: winnerId,
    brackets_scored: totalAffected, scored_at: new Date().toISOString(),
  });

  return batchErrors === 0;
}

async function updateRanksBatched(
  supabase: ReturnType<typeof getServiceClient>, debugLog: string[],
) {
  const { data: groups, error } = await supabase.rpc("w_get_score_groups");
  if (error || !groups) { debugLog.push(`W_RANKS FAIL: ${error?.message}`); return; }

  let rank = 1;
  for (const g of groups) {
    await supabase.from("w_brackets")
      .update({ rank })
      .eq("total_points", g.total_points)
      .eq("correct_picks", g.correct_picks);
    rank += Number(g.cnt);
  }
  debugLog.push(`W_RANKS: ${groups.length} groups, 1–${rank - 1}`);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const [espnRes, existingRes, nodesRes, teamsRes, scoredLogRes, idLoRes, idHiRes] =
      await Promise.all([
        fetch(ESPN_URL, { next: { revalidate: 0 } }),
        supabase.from("w_game_results").select("game_idx, winner_id"),
        supabase.from("w_game_nodes").select("game_idx, round, team_a_id, team_b_id"),
        supabase.from("w_tournament_teams").select("team_id, name, seed"),
        supabase.from("w_scoring_log").select("game_idx"),
        supabase.from("w_brackets").select("id").order("id", { ascending: true }).limit(1).single(),
        supabase.from("w_brackets").select("id").order("id", { ascending: false }).limit(1).single(),
      ]);

    const minId = idLoRes.data?.id ?? 0;
    const maxId = idHiRes.data?.id ?? 0;

    const espnJson = await espnRes.json();
    const events: ESPNGame[] = espnJson.events ?? [];
    const existingResults = existingRes.data ?? [];
    const recorded = new Set(existingResults.map((r: any) => r.game_idx));
    const nodes = nodesRes.data ?? [];
    const teams = teamsRes.data ?? [];
    const nodeRoundMap = new Map(nodes.map((n: any) => [n.game_idx, n.round]));
    const dbNameToId = new Map(teams.map((t: any) => [t.name, t.team_id]));
    const scoredSet = new Set((scoredLogRes.data ?? []).map((r: any) => r.game_idx));

    let newResults = 0;
    const liveGameIdxs: number[] = [];
    const debugLog: string[] = [];

    debugLog.push(`W ID range: ${minId}–${maxId}, batch size: ${BATCH_SIZE}`);

    // ── STEP 1: Reconcile orphaned games ──
    const orphaned = existingResults.filter((r: any) => !scoredSet.has(r.game_idx));
    if (orphaned.length > 0) {
      debugLog.push(`W_RECONCILE: ${orphaned.length} orphaned games`);
      for (const orphan of orphaned) {
        const round = nodeRoundMap.get(orphan.game_idx) as string;
        const pts = ROUND_POINTS[round as Round] ?? 0;
        if (await scoreBatched(supabase, orphan.game_idx, orphan.winner_id, pts, minId, maxId, debugLog)) {
          newResults++;
        }
      }
    }

    // ── STEP 2: Process ESPN events ──
    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const espnTeam1 = comp.competitors?.[0]?.team?.displayName ?? "?";
      const espnTeam2 = comp.competitors?.[1]?.team?.displayName ?? "?";

      if (event.status.type.completed) {
        const winnerObj = comp.competitors?.find((c) => c.winner);
        if (!winnerObj) { debugLog.push(`W_SKIP ${espnTeam1} vs ${espnTeam2}: no winner`); continue; }
        const winnerName = winnerObj.team.displayName;
        const winnerId = resolveESPN(winnerName, dbNameToId);
        if (!winnerId) { debugLog.push(`W_SKIP ${winnerName}: not in ESPN_TO_DB map`); continue; }
        const match = matchToNode(comp, nodes, dbNameToId, recorded, true);
        if (!match) { debugLog.push(`W_SKIP ${espnTeam1} vs ${espnTeam2}: already recorded or no match`); continue; }

        const roundStr = parseRoundFromNotes(comp.notes ?? []);
        const round = ROUND_MAP[roundStr] ?? match.node.round;
        const winnerSeed = teams.find((t: any) => t.team_id === winnerId)?.seed ?? 0;

        const { error: insertErr } = await supabase.from("w_game_results").insert({
          game_idx: match.node.game_idx, winner_id: winnerId,
          winner_name: winnerName, winner_seed: winnerSeed,
          completed_at: new Date().toISOString(),
        });
        if (insertErr) { debugLog.push(`W_ERROR game_idx ${match.node.game_idx}: ${insertErr.message}`); continue; }

        const roundPts = ROUND_POINTS[round as Round] ?? 0;
        if (await scoreBatched(supabase, match.node.game_idx, winnerId, roundPts, minId, maxId, debugLog)) {
          recorded.add(match.node.game_idx);
          newResults++;
        }
        continue;
      }

      if (event.status.type.state === "in") {
        const match = matchToNode(comp, nodes, dbNameToId, recorded, true);
        if (match) {
          liveGameIdxs.push(match.node.game_idx);
          debugLog.push(`W_LIVE game_idx ${match.node.game_idx}: ${espnTeam1} vs ${espnTeam2}`);
        }
      }
    }

    // ── STEP 3: Metadata ──
    await supabase.from("w_metadata").upsert({ key: "live_game_idxs", value: JSON.stringify(liveGameIdxs) });
    const { count: gamesCompleted } = await supabase.from("w_game_results").select("game_idx", { count: "exact" });
    await supabase.from("w_metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted ?? 0) },
      { key: "last_updated", value: new Date().toISOString() },
    ]);

    // ── STEP 4: Ranks ──
    if (newResults > 0) {
      await updateRanksBatched(supabase, debugLog);
    }

    return NextResponse.json({
      ok: true, tournament: "womens", new_results: newResults,
      live_games: liveGameIdxs.length, games_complete: gamesCompleted,
      debug: debugLog,
    });
  } catch (err: any) {
    console.error("Women's cron error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
