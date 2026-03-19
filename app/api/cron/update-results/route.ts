// app/api/cron/update-results/route.ts
//
// Called by Vercel Cron every 15 minutes during tournament windows.
// Scrapes ESPN's public scoreboard for completed NCAA tournament games
// and updates game_results + bracket scores in Supabase.
//
// Key design decisions:
// - Resolves later-round matchups by following source chain through game_results
// - Uses multi-pass processing: if game A's result unlocks game B's matchup,
//   both get processed in the same cron cycle
// - Matches ESPN games using BOTH competitors for accurate game_node matching
// - Robust team name matching with ESPN alias map
// - Skips First Four games (not part of 63-game bracket)
// - Fetches today + yesterday to catch games that finish late

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db";
import { ROUND_POINTS, type Round } from "@/lib/types";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// ─── ESPN display name → our DB name (lowercase) ─────────────────────
// Add entries as mismatches are discovered during the tournament.
const ESPN_NAME_ALIASES: Record<string, string> = {
  "uconn":                 "connecticut",
  "unc":                   "north carolina",
  "lsu":                   "louisiana st",
  "smu":                   "southern methodist",
  "ucf":                   "central florida",
  "byu":                   "brigham young",
  "unlv":                  "nevada las vegas",
  "vcu":                   "virginia commonwealth",
  "tcu":                   "texas christian",
  "ole miss":              "mississippi",
  "pitt":                  "pittsburgh",
  "umass":                 "massachusetts",
  "uni":                   "northern iowa",
  "uab":                   "alabama birmingham",
  "miami (fl)":            "miami fl",
  "miami (oh)":            "miami oh",
  "n.c. state":            "nc state",
  "saint mary's":          "st mary's ca",
  "saint mary's (ca)":     "st mary's ca",
  "saint peter's":         "st peter's",
  "saint joseph's":        "st joseph's pa",
  "loyola chicago":        "loyola-chicago",
  "loyola-chicago":        "loyola-chicago",
  "florida atlantic":      "fl atlantic",
  "florida gulf coast":    "fgcu",
  "fiu":                   "florida intl",
  "cal baptist":           "california baptist",
  "california baptist":    "california baptist",
  "prairie view a&m":      "prairie view",
  "north dakota st":       "n dakota st",
  "north dakota state":    "n dakota st",
  "south dakota st":       "s dakota st",
  "south dakota state":    "s dakota st",
  "east tennessee st":     "etsu",
  "east tennessee state":  "etsu",
  "middle tennessee":      "mtsu",
  "southeast missouri st": "se missouri st",
  "mcneese state":         "mcneese",
  "mcneese st":            "mcneese",
  "south florida":         "south florida",
  "usf":                   "south florida",
  "texas a&m":             "texas a&m",
};

// ─── Types ───────────────────────────────────────────────────────────

interface ESPNEvent {
  id: string;
  status: { type: { completed: boolean } };
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

interface GameNode {
  game_idx: number;
  round: string;
  region: string;
  team_a_id: number | null;
  team_b_id: number | null;
  source_a: number | null;
  source_b: number | null;
}

interface TeamInfo {
  team_id: number;
  name: string;
  seed: number;
}

// ─── Resolve matchups from current game state ────────────────────────

function resolveMatchups(
  nodes: GameNode[],
  results: Map<number, number>,
): Map<number, { team_a: number; team_b: number }> {
  const resolved = new Map<number, { team_a: number; team_b: number }>();

  for (const node of nodes) {
    let team_a: number | null = null;
    let team_b: number | null = null;

    if (node.round === "round_64") {
      team_a = node.team_a_id;
      team_b = node.team_b_id;
    } else {
      if (node.source_a != null) team_a = results.get(node.source_a) ?? null;
      if (node.source_b != null) team_b = results.get(node.source_b) ?? null;
    }

    if (team_a != null && team_b != null) {
      resolved.set(node.game_idx, { team_a, team_b });
    }
  }

  return resolved;
}

// ─── Team name matching ──────────────────────────────────────────────

function buildTeamLookup(teams: TeamInfo[]): {
  byId: Map<number, TeamInfo>;
  byName: Map<string, number>;
} {
  const byId = new Map<number, TeamInfo>();
  const byName = new Map<string, number>();

  for (const t of teams) {
    byId.set(t.team_id, t);
    const lower = t.name.toLowerCase().trim();
    byName.set(lower, t.team_id);
    byName.set(lower.replace(/\./g, "").replace(/'/g, ""), t.team_id);
  }

  for (const [espnName, dbName] of Object.entries(ESPN_NAME_ALIASES)) {
    const tid = byName.get(dbName.toLowerCase().trim());
    if (tid != null) {
      byName.set(espnName.toLowerCase().trim(), tid);
    }
  }

  return { byId, byName };
}

function matchTeamName(name: string, byName: Map<string, number>): number | null {
  const lower = name.toLowerCase().trim();
  let tid = byName.get(lower);
  if (tid != null) return tid;

  const cleaned = lower.replace(/\./g, "").replace(/'/g, "");
  tid = byName.get(cleaned);
  if (tid != null) return tid;

  tid = byName.get(cleaned.replace(/\bstate\b/, "st"));
  if (tid != null) return tid;

  return null;
}

// ─── Tournament game detection ───────────────────────────────────────

function isFirstFour(event: ESPNEvent): boolean {
  const notes = event.competitions?.[0]?.notes ?? [];
  return notes.some((n) =>
    (n.headline ?? "").toLowerCase().includes("first four")
  );
}

// ─── Main handler ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const log: string[] = [];

  try {
    // ── 1. Fetch ESPN scoreboard (today + yesterday) ──
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

    const [resToday, resYesterday] = await Promise.all([
      fetch(`${ESPN_SCOREBOARD_URL}?dates=${fmt(today)}&groups=100&limit=100`, {
        next: { revalidate: 0 },
      }),
      fetch(`${ESPN_SCOREBOARD_URL}?dates=${fmt(yesterday)}&groups=100&limit=100`, {
        next: { revalidate: 0 },
      }),
    ]);

    const jsonToday = await resToday.json();
    const jsonYesterday = await resYesterday.json();

    // Deduplicate by event ID
    const seenIds = new Set<string>();
    const events: ESPNEvent[] = [
      ...(jsonToday.events ?? []),
      ...(jsonYesterday.events ?? []),
    ].filter((e) => {
      if (seenIds.has(e.id)) return false;
      seenIds.add(e.id);
      return true;
    });

    log.push(`Fetched ${events.length} ESPN events`);

    // ── 2. Load Supabase state ──
    const [nodesRes, resultsRes, teamsRes] = await Promise.all([
      supabase.from("game_nodes").select("*").order("game_idx"),
      supabase.from("game_results").select("*"),
      supabase.from("tournament_teams").select("*"),
    ]);

    const nodes: GameNode[] = nodesRes.data ?? [];
    const teams: TeamInfo[] = teamsRes.data ?? [];
    const existingResults = resultsRes.data ?? [];

    const recorded = new Map<number, number>();
    for (const r of existingResults) {
      recorded.set(r.game_idx, r.winner_id);
    }

    const { byId: teamById, byName: teamByName } = buildTeamLookup(teams);

    log.push(
      `State: ${nodes.length} nodes, ${recorded.size} recorded, ${teams.length} teams`
    );

    // ── 3. Filter to completed tournament games with matched teams ──
    interface ParsedGame {
      eventId: string;
      winnerId: number;
      loserId: number;
      winnerName: string;
      loserName: string;
    }

    const parsedGames: ParsedGame[] = [];
    const unmatchedTeams: string[] = [];

    for (const event of events) {
      if (!event.status.type.completed) continue;
      if (isFirstFour(event)) continue;

      const comp = event.competitions?.[0];
      if (!comp?.competitors || comp.competitors.length !== 2) continue;

      const winnerComp = comp.competitors.find((c) => c.winner);
      const loserComp = comp.competitors.find((c) => !c.winner);
      if (!winnerComp || !loserComp) continue;

      const winnerId = matchTeamName(winnerComp.team.displayName, teamByName);
      const loserId = matchTeamName(loserComp.team.displayName, teamByName);

      // If both teams are in our tournament, it's a bracket game
      if (winnerId == null || loserId == null) {
        // Only log if at least one team matched (likely a tournament game)
        if (winnerId != null || loserId != null) {
          const missing = winnerId == null
            ? winnerComp.team.displayName
            : loserComp.team.displayName;
          unmatchedTeams.push(missing);
        }
        continue;
      }

      parsedGames.push({
        eventId: event.id,
        winnerId,
        loserId,
        winnerName: winnerComp.team.displayName,
        loserName: loserComp.team.displayName,
      });
    }

    log.push(`${parsedGames.length} completed tournament games found`);

    if (unmatchedTeams.length > 0) {
      log.push(`Unmatched team names: ${unmatchedTeams.join(", ")}`);
    }

    // ── 4. Multi-pass processing ──
    // Each pass: resolve matchups → match games → insert results
    // Repeat until no new results are inserted (handles dependencies
    // where game B's matchup depends on game A's result)
    let totalNewResults = 0;
    const processedEventIds = new Set<string>();

    for (let pass = 0; pass < 5; pass++) {
      const resolvedMatchups = resolveMatchups(nodes, recorded);
      let passResults = 0;

      for (const game of parsedGames) {
        if (processedEventIds.has(game.eventId)) continue;

        // Find matching game_node
        let matchedNode: GameNode | null = null;
        for (const node of nodes) {
          if (recorded.has(node.game_idx)) continue;

          const resolved = resolvedMatchups.get(node.game_idx);
          if (!resolved) continue;

          const teamsMatch =
            (resolved.team_a === game.winnerId && resolved.team_b === game.loserId) ||
            (resolved.team_a === game.loserId && resolved.team_b === game.winnerId);

          if (teamsMatch) {
            matchedNode = node;
            break;
          }
        }

        if (!matchedNode) continue;

        // Insert result
        const winnerInfo = teamById.get(game.winnerId);
        const { error: insertErr } = await supabase.from("game_results").insert({
          game_idx: matchedNode.game_idx,
          winner_id: game.winnerId,
          winner_name: winnerInfo?.name ?? game.winnerName,
          winner_seed: winnerInfo?.seed ?? 0,
          completed_at: new Date().toISOString(),
        });

        if (insertErr) {
          log.push(`Insert failed game_idx ${matchedNode.game_idx}: ${insertErr.message}`);
          continue;
        }

        // Score all brackets
        const roundPts = ROUND_POINTS[matchedNode.round as Round] ?? 0;
        const { error: scoreErr } = await supabase.rpc("score_game", {
          p_game_idx: matchedNode.game_idx,
          p_winner_id: game.winnerId,
          p_points: roundPts,
        });

        if (scoreErr) {
          log.push(`Score failed game_idx ${matchedNode.game_idx}: ${scoreErr.message}`);
        }

        recorded.set(matchedNode.game_idx, game.winnerId);
        processedEventIds.add(game.eventId);
        passResults++;

        log.push(
          `✓ [Pass ${pass + 1}] Game ${matchedNode.game_idx} (${matchedNode.round}): ` +
            `${winnerInfo?.name ?? game.winnerName} def. ${game.loserName} → ${roundPts} pts`
        );
      }

      totalNewResults += passResults;

      // If no new results this pass, all dependencies are resolved
      if (passResults === 0) break;

      log.push(`Pass ${pass + 1}: ${passResults} new results`);
    }

    // ── 5. Update metadata ──
    const gamesCompleted = recorded.size;

    await supabase.from("metadata").upsert([
      { key: "games_completed", value: String(gamesCompleted) },
      { key: "last_updated", value: new Date().toISOString() },
    ]);

    // ── 6. Update ranks if anything changed ──
    if (totalNewResults > 0) {
      const { error: rankErr } = await supabase.rpc("update_ranks");
      if (rankErr) {
        log.push(`Rank update failed: ${rankErr.message}`);
      } else {
        log.push(`Ranks updated`);
      }
    }

    return NextResponse.json({
      ok: true,
      new_results: totalNewResults,
      games_complete: gamesCompleted,
      log,
    });
  } catch (err: any) {
    console.error("Cron error:", err);
    return NextResponse.json({ error: err.message, log }, { status: 500 });
  }
}
