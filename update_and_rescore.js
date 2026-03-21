// update_and_rescore.js
//
// Fetches ESPN, inserts new game results, scores only new games via Postgres RPC.
// Flow: fetch mens → score mens → fetch womens → score womens
// Each new game scores 1M brackets in ~20s via a single RPC call (no network per batch).
//
// Usage:
//   node update_and_rescore.js              # default: fetch + score new games only
//   node update_and_rescore.js --full       # emergency: full rescore from scratch
//   node update_and_rescore.js --fetch-only # just insert games, no scoring
//   node update_and_rescore.js --mens       # men's only
//   node update_and_rescore.js --womens     # women's only

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const https = require("https");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const MENS_ONLY   = args.includes("--mens");
const WOMENS_ONLY = args.includes("--womens");
const FETCH_ONLY  = args.includes("--fetch-only");
const FULL_MODE   = args.includes("--full");
const DO_MENS     = !WOMENS_ONLY;
const DO_WOMENS   = !MENS_ONLY;

const ROUND_POINTS = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

const ROUND_MAP = {
  "First Four": "First Four", "First Round": "round_64",
  "Second Round": "round_32", "Sweet 16": "sweet_16",
  "Elite Eight": "elite_8", "Final Four": "final_four",
  "Championship": "championship",
  "1st Round": "round_64", "2nd Round": "round_32",
};

const FETCH_BATCH = 50000;
const WRITE_CHUNK = 1000;

// ═══════════════════════════════════════════════════════════════════════
// ESPN NAME MAPS
// ═══════════════════════════════════════════════════════════════════════

const MENS_ESPN_TO_DB = {
  "Duke Blue Devils": "Duke", "UConn Huskies": "Connecticut",
  "Michigan State Spartans": "Michigan St", "Kansas Jayhawks": "Kansas",
  "St. John's Red Storm": "St John's", "Louisville Cardinals": "Louisville",
  "UCLA Bruins": "UCLA", "Ohio State Buckeyes": "Ohio St",
  "TCU Horned Frogs": "TCU", "UCF Knights": "UCF",
  "South Florida Bulls": "South Florida", "Northern Iowa Panthers": "Northern Iowa",
  "California Baptist Lancers": "Cal Baptist", "North Dakota State Bison": "N Dakota St",
  "Furman Paladins": "Furman", "Siena Saints": "Siena",
  "Michigan Wolverines": "Michigan", "Iowa State Cyclones": "Iowa St",
  "Virginia Cavaliers": "Virginia", "Alabama Crimson Tide": "Alabama",
  "Texas Tech Red Raiders": "Texas Tech", "Tennessee Volunteers": "Tennessee",
  "Kentucky Wildcats": "Kentucky", "Georgia Bulldogs": "Georgia",
  "Saint Louis Billikens": "St Louis", "Santa Clara Broncos": "Santa Clara",
  "Miami (OH) RedHawks": "Miami OH", "Akron Zips": "Akron",
  "Hofstra Pride": "Hofstra", "Wright State Raiders": "Wright St",
  "Tennessee State Tigers": "Tennessee St", "Howard Bison": "Howard",
  "Florida Gators": "Florida", "Houston Cougars": "Houston",
  "Illinois Fighting Illini": "Illinois", "Nebraska Cornhuskers": "Nebraska",
  "Vanderbilt Commodores": "Vanderbilt", "North Carolina Tar Heels": "North Carolina",
  "Saint Mary's Gaels": "St Mary's CA", "Clemson Tigers": "Clemson",
  "Iowa Hawkeyes": "Iowa", "Texas A&M Aggies": "Texas A&M",
  "VCU Rams": "VCU", "McNeese Cowboys": "McNeese St",
  "Troy Trojans": "Troy", "Pennsylvania Quakers": "Penn",
  "Idaho Vandals": "Idaho", "Prairie View A&M Panthers": "Prairie View",
  "Arizona Wildcats": "Arizona", "Purdue Boilermakers": "Purdue",
  "Gonzaga Bulldogs": "Gonzaga", "Arkansas Razorbacks": "Arkansas",
  "Wisconsin Badgers": "Wisconsin", "BYU Cougars": "BYU",
  "Miami Hurricanes": "Miami FL", "Villanova Wildcats": "Villanova",
  "Utah State Aggies": "Utah St", "Missouri Tigers": "Missouri",
  "Texas Longhorns": "Texas", "High Point Panthers": "High Point",
  "Hawai'i Rainbow Warriors": "Hawaii", "Kennesaw State Owls": "Kennesaw",
  "Queens Royals": "Queens NC", "LIU Sharks": "LIU Brooklyn",
  "NC State Wolfpack": "NC State", "Long Island University Sharks": "LIU Brooklyn",
  "Queens University Royals": "Queens NC", "UMBC Retrievers": "UMBC",
  "SMU Mustangs": "SMU",
};

const WOMENS_ESPN_TO_DB = {
  "UConn Huskies": "Connecticut", "South Carolina Gamecocks": "South Carolina",
  "UCLA Bruins": "UCLA", "Texas Longhorns": "Texas",
  "LSU Tigers": "LSU", "Notre Dame Fighting Irish": "Notre Dame",
  "Duke Blue Devils": "Duke", "USC Trojans": "USC",
  "Ohio State Buckeyes": "Ohio St", "Iowa State Cyclones": "Iowa St",
  "Michigan State Spartans": "Michigan St", "NC State Wolfpack": "NC State",
  "Oklahoma Sooners": "Oklahoma", "Nebraska Cornhuskers": "Nebraska",
  "North Carolina Tar Heels": "North Carolina", "Tennessee Lady Volunteers": "Tennessee",
  "Kentucky Wildcats": "Kentucky", "Alabama Crimson Tide": "Alabama",
  "Maryland Terrapins": "Maryland", "Baylor Bears": "Baylor",
  "Georgia Lady Bulldogs": "Georgia", "Gonzaga Bulldogs": "Gonzaga",
  "Michigan Wolverines": "Michigan", "Iowa Hawkeyes": "Iowa",
  "Oregon Ducks": "Oregon", "Colorado Buffaloes": "Colorado",
  "Louisville Cardinals": "Louisville", "Villanova Wildcats": "Villanova",
  "West Virginia Mountaineers": "West Virginia", "Oklahoma State Cowgirls": "Oklahoma St",
  "TCU Horned Frogs": "TCU", "Vanderbilt Commodores": "Vanderbilt",
  "Virginia Tech Hokies": "Virginia Tech", "Illinois Fighting Illini": "Illinois",
  "Clemson Tigers": "Clemson", "Washington Huskies": "Washington",
  "Ole Miss Rebels": "Mississippi", "High Point Panthers": "High Point",
  "Princeton Tigers": "Princeton", "Syracuse Orange": "Syracuse",
  "Virginia Cavaliers": "Virginia", "Minnesota Golden Gophers": "Minnesota",
  "Howard Bison": "Howard", "Idaho Vandals": "Idaho",
  "Rhode Island Rams": "Rhode Island", "Fairfield Stags": "Fairfield",
  "Holy Cross Crusaders": "Holy Cross", "Jacksonville Dolphins": "Jacksonville",
  "James Madison Dukes": "James Madison", "Vermont Catamounts": "Vermont",
  "Texas Tech Lady Raiders": "Texas Tech", "UC San Diego Tritons": "UC San Diego",
  "Arizona State Sun Devils": "Arizona St", "California Baptist Lancers": "Cal Baptist",
  "Charleston Cougars": "Col Charleston", "Colorado State Rams": "Colorado St",
  "Fairleigh Dickinson Knights": "F Dickinson", "Green Bay Phoenix": "WI Green Bay",
  "Miami (OH) RedHawks": "Miami OH", "Missouri State Lady Bears": "Missouri St",
  "Murray State Racers": "Murray St", "South Dakota State Jackrabbits": "S Dakota St",
  "Southern Jaguars": "Southern Univ", "UTSA Roadrunners": "UT San Antonio",
  "Western Illinois Leathernecks": "W Illinois", "Samford Bulldogs": "Samford",
};

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchESPN(baseUrl) {
  const seen = new Set();
  const all = [];
  for (const d of [getDateStr(1), getDateStr(0)]) {
    const json = await httpGet(`${baseUrl}&dates=${d}`);
    for (const e of json.events || []) {
      if (!seen.has(e.id)) { seen.add(e.id); all.push(e); }
    }
  }
  return all;
}

function parseRound(notes) {
  const h = notes?.[0]?.headline ?? "";
  const p = h.split(" - ");
  const r = p[p.length - 1]?.trim() ?? "";
  return ROUND_MAP[r] ?? r;
}

function resolveESPN(name, espnToDb, dbNameToId) {
  const dbName = espnToDb[name];
  if (dbName) return dbNameToId.get(dbName);
  const direct = dbNameToId.get(name);
  if (direct) return direct;
  const words = name.split(" ");
  for (let i = words.length - 1; i >= 1; i--) {
    const match = dbNameToId.get(words.slice(0, i).join(" "));
    if (match) return match;
  }
  return undefined;
}

function matchToNode(id1, id2, nodes, recorded, winnerByIdx) {
  for (const node of nodes) {
    if (recorded.has(node.game_idx)) continue;
    let teamA = node.team_a_id ?? null;
    let teamB = node.team_b_id ?? null;
    if (!teamA && node.source_a != null) teamA = winnerByIdx.get(node.source_a) ?? null;
    if (!teamB && node.source_b != null) teamB = winnerByIdx.get(node.source_b) ?? null;
    if (!teamA || !teamB) continue;
    if (new Set([teamA, teamB]).has(id1) && new Set([teamA, teamB]).has(id2)) return node;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// FETCH + INSERT
// ═══════════════════════════════════════════════════════════════════════

async function fetchAndInsert(gender) {
  const w = gender === "womens";
  const label = w ? "WOMEN'S" : "MEN'S";
  const espnUrl = w
    ? "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?groups=100&limit=100"
    : "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100";
  const espnToDb = w ? WOMENS_ESPN_TO_DB : MENS_ESPN_TO_DB;
  const tbl = {
    results: w ? "w_game_results" : "game_results",
    nodes: w ? "w_game_nodes" : "game_nodes",
    teams: w ? "w_tournament_teams" : "tournament_teams",
    metadata: w ? "w_metadata" : "metadata",
  };

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}: FETCH + INSERT`);
  console.log(`${"═".repeat(60)}`);

  const [existingRes, nodesRes, teamsRes] = await Promise.all([
    supabase.from(tbl.results).select("game_idx, winner_id"),
    supabase.from(tbl.nodes).select("game_idx, round, region, team_a_id, team_b_id, source_a, source_b"),
    supabase.from(tbl.teams).select("team_id, name, seed"),
  ]);

  const existing = existingRes.data ?? [];
  const nodes = nodesRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const recorded = new Set(existing.map(r => r.game_idx));
  const winnerByIdx = new Map(existing.map(r => [r.game_idx, r.winner_id]));
  const dbNameToId = new Map(teams.map(t => [t.name, t.team_id]));

  console.log(`  DB: ${existing.length} results | Fetching ESPN...`);

  const events = await fetchESPN(espnUrl);
  const insertedGames = [];
  const liveGameIdxs = [];
  const skipped = [];

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const t1 = comp.competitors?.[0]?.team?.displayName ?? "?";
    const t2 = comp.competitors?.[1]?.team?.displayName ?? "?";
    const roundStr = parseRound(comp.notes ?? []);

    // Skip First Four
    if (roundStr === "First Four" || (comp.notes?.[0]?.headline ?? "").includes("First Four")) continue;

    if (event.status?.type?.completed) {
      const winnerObj = comp.competitors?.find(c => c.winner);
      if (!winnerObj) { skipped.push(`${t1} vs ${t2}: no winner`); continue; }
      const winnerName = winnerObj.team.displayName;
      const winnerId = resolveESPN(winnerName, espnToDb, dbNameToId);
      if (!winnerId) { skipped.push(`${winnerName}: not in name map`); continue; }
      const id1 = resolveESPN(t1, espnToDb, dbNameToId);
      const id2 = resolveESPN(t2, espnToDb, dbNameToId);
      if (!id1 || !id2) { skipped.push(`${t1} vs ${t2}: can't resolve`); continue; }

      const node = matchToNode(id1, id2, nodes, recorded, winnerByIdx);
      if (!node) continue; // already recorded

      const round = ROUND_MAP[roundStr] ?? node.round;
      const seed = teams.find(t => t.team_id === winnerId)?.seed ?? 0;

      const { error } = await supabase.from(tbl.results).insert({
        game_idx: node.game_idx, winner_id: winnerId,
        winner_name: winnerName, winner_seed: seed,
        completed_at: new Date().toISOString(),
      });
      if (error) { skipped.push(`game_idx ${node.game_idx}: ${error.message}`); continue; }

      recorded.add(node.game_idx);
      winnerByIdx.set(node.game_idx, winnerId);
      insertedGames.push({ game_idx: node.game_idx, winner_id: winnerId, round, winner_name: winnerName });
      console.log(`    ✓ game_idx ${node.game_idx}: ${winnerName} (${round})`);

    } else if (event.status?.type?.state === "in") {
      const id1 = resolveESPN(t1, espnToDb, dbNameToId);
      const id2 = resolveESPN(t2, espnToDb, dbNameToId);
      if (id1 && id2) {
        const node = matchToNode(id1, id2, nodes, recorded, winnerByIdx);
        if (node) liveGameIdxs.push(node.game_idx);
      }
    }
  }

  // Update metadata
  const totalResults = existing.length + insertedGames.length;
  await supabase.from(tbl.metadata).upsert([
    { key: "live_game_idxs", value: JSON.stringify(liveGameIdxs) },
    { key: "games_completed", value: String(totalResults) },
    { key: "last_updated", value: new Date().toISOString() },
  ]);

  // Detect orphans: in game_results but not in scoring_log (e.g. previous scoring failed)
  const scoringLogTbl = w ? "w_scoring_log" : "scoring_log";
  const nodeMap = new Map(nodes.map(n => [n.game_idx, n]));
  const { data: scoredRows } = await supabase.from(scoringLogTbl).select("game_idx");
  const scoredSet = new Set((scoredRows ?? []).map(r => r.game_idx));
  const allResults = [...existing, ...insertedGames.map(g => ({ game_idx: g.game_idx, winner_id: g.winner_id }))];

  for (const r of allResults) {
    if (!scoredSet.has(r.game_idx) && !insertedGames.find(g => g.game_idx === r.game_idx)) {
      const node = nodeMap.get(r.game_idx);
      if (node) {
        const team = teams.find(t => t.team_id === r.winner_id);
        insertedGames.push({
          game_idx: r.game_idx,
          winner_id: r.winner_id,
          round: node.round,
          winner_name: team?.name ?? `team_${r.winner_id}`,
        });
        console.log(`    ⚠ Orphan found: game_idx ${r.game_idx} (in DB but never scored)`);
      }
    }
  }

  console.log(`  Inserted: ${insertedGames.length > 0 ? insertedGames.length : 0} | Total: ${totalResults} | Live: ${liveGameIdxs.length}`);
  if (skipped.length > 0) {
    console.log(`  Skipped (${skipped.length}):`);
    skipped.forEach(s => console.log(`    • ${s}`));
  }

  return { totalResults, insertedGames };
}

// ═══════════════════════════════════════════════════════════════════════
// COMPUTE RANKS (tries Postgres RPC, falls back to JS loop)
// ═══════════════════════════════════════════════════════════════════════

async function computeRanks(gender) {
  const w = gender === "womens";
  const rpcCompute = w ? "w_compute_ranks" : "compute_ranks";
  const rpcGroups = w ? "w_get_score_groups" : "get_score_groups";
  const tbl = w ? "w_brackets" : "brackets";

  console.log(`  Computing ranks...`);
  const t0 = Date.now();

  // Try single RPC call first
  const { data, error } = await supabase.rpc(rpcCompute);
  if (!error) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`    ✓ Ranks updated via RPC (${data} groups) in ${elapsed}s`);
    return;
  }

  // Fallback to JS loop
  console.log(`    RPC not available, using JS fallback...`);
  const { data: groups, error: grpErr } = await supabase.rpc(rpcGroups);
  if (grpErr) {
    console.log(`    Ranks failed: ${grpErr.message}`);
    return;
  }
  let rank = 1;
  for (const g of groups) {
    await supabase.from(tbl)
      .update({ rank })
      .eq("total_points", g.total_points)
      .eq("correct_picks", g.correct_picks);
    rank += Number(g.cnt);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    ✓ Ranks updated via JS (${groups.length} groups) in ${elapsed}s`);
}

// ═══════════════════════════════════════════════════════════════════════
// SCORE NEW GAMES (batched RPCs — each batch ~1s inside Postgres)
// ═══════════════════════════════════════════════════════════════════════

async function scoreNewGames(gender, newGames) {
  const w = gender === "womens";
  const label = w ? "WOMEN'S" : "MEN'S";
  const rpcName = w ? "w_score_game_range" : "score_game_range";
  const BATCH = 25000;
  const tbl = {
    brackets: w ? "w_brackets" : "brackets",
    scoring_log: w ? "w_scoring_log" : "scoring_log",
  };

  // Get ID range once
  const { data: lo } = await supabase.from(tbl.brackets).select("id").order("id", { ascending: true }).limit(1).single();
  const { data: hi } = await supabase.from(tbl.brackets).select("id").order("id", { ascending: false }).limit(1).single();
  if (!lo || !hi) { console.log("  No brackets found."); return false; }
  const minId = lo.id, maxId = hi.id;
  const totalBatches = Math.ceil((maxId - minId + 1) / BATCH);

  console.log(`\n  ${label}: SCORING ${newGames.length} new game${newGames.length === 1 ? "" : "s"} (${totalBatches} batches each)`);

  for (const game of newGames) {
    const pts = ROUND_POINTS[game.round] || 0;
    const gameT0 = Date.now();
    let totalAffected = 0;
    let batchErrors = 0;

    for (let i = 0; i < totalBatches; i++) {
      const start = minId + i * BATCH;
      const end = start + BATCH;
      const { data, error } = await supabase.rpc(rpcName, {
        p_game_idx: game.game_idx,
        p_winner_id: game.winner_id,
        p_points: pts,
        p_min_id: start,
        p_max_id: end,
      });
      if (error) {
        batchErrors++;
        console.log(`    Batch ${i + 1} failed: ${error.message}`);
      } else {
        totalAffected += (data ?? 0);
      }
      const pct = Math.round(((i + 1) / totalBatches) * 100);
      const elapsed = ((Date.now() - gameT0) / 1000).toFixed(0);
      process.stdout.write(`\r    game_idx ${game.game_idx} ${game.winner_name}: batch ${i + 1}/${totalBatches} (${pct}%) [${elapsed}s]`);
    }

    const elapsed = ((Date.now() - gameT0) / 1000).toFixed(1);
    console.log(`\n    ✓ ${totalAffected.toLocaleString()} rows, ${elapsed}s, ${batchErrors} errors`);

    // Log to scoring_log
    await supabase.from(tbl.scoring_log).insert({
      game_idx: game.game_idx, winner_id: game.winner_id,
      brackets_scored: totalAffected, scored_at: new Date().toISOString(),
    });
  }

  // Update ranks
  await computeRanks(gender);

  // Sanity check
  const { data: top } = await supabase.from(tbl.brackets)
    .select("total_points, correct_picks, games_decided, accuracy, rank")
    .order("total_points", { ascending: false }).limit(1).single();
  console.log(`  Top bracket:`, top);

  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// FULL RESCORE (emergency — batched Postgres RPC)
// ═══════════════════════════════════════════════════════════════════════

async function fullRescore(gender) {
  const w = gender === "womens";
  const label = w ? "WOMEN'S" : "MEN'S";
  const rpcName = w ? "rescore_batch_w" : "rescore_batch";
  const BATCH = 25000;
  const tbl = {
    brackets: w ? "w_brackets" : "brackets",
    results: w ? "w_game_results" : "game_results",
    scoring_log: w ? "w_scoring_log" : "scoring_log",
  };

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}: FULL RESCORE (emergency)`);
  console.log(`${"═".repeat(60)}`);

  const { data: lo } = await supabase.from(tbl.brackets).select("id").order("id", { ascending: true }).limit(1).single();
  const { data: hi } = await supabase.from(tbl.brackets).select("id").order("id", { ascending: false }).limit(1).single();
  if (!lo || !hi) { console.log("  No brackets."); return; }
  const minId = lo.id, maxId = hi.id;
  const totalBatches = Math.ceil((maxId - minId + 1) / BATCH);

  console.log(`  ID range: ${minId}–${maxId} | Batches: ${totalBatches}`);

  const t0 = Date.now();
  let totalScored = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = minId + i * BATCH;
    const end = start + BATCH;
    const { data, error } = await supabase.rpc(rpcName, { p_min_id: start, p_max_id: end });

    if (error) {
      console.log(`\n  ✗ Batch ${i + 1} failed: ${error.message}`);
      console.log(`  Run score_functions.sql in Supabase SQL Editor first.`);
      return;
    }

    const rows = Array.isArray(data) ? data[0]?.rows_updated ?? 0 : data?.rows_updated ?? 0;
    totalScored += rows;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r  Batch ${i + 1}/${totalBatches} — ${totalScored.toLocaleString()} scored [${elapsed}s]`);
  }

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ✓ ${totalScored.toLocaleString()} brackets rescored in ${totalTime}s\n`);

  // Rebuild scoring_log
  await supabase.from(tbl.scoring_log).delete().gte("id", 0);
  const { data: results } = await supabase.from(tbl.results).select("game_idx, winner_id");
  for (const g of results) {
    await supabase.from(tbl.scoring_log).insert({
      game_idx: g.game_idx, winner_id: g.winner_id,
      brackets_scored: totalScored, scored_at: new Date().toISOString(),
    });
  }
  console.log(`  ✓ Scoring log rebuilt (${results.length} games)`);

  // Ranks
  await computeRanks(gender);

  const { data: top } = await supabase.from(tbl.brackets)
    .select("total_points, correct_picks, games_decided, accuracy, rank")
    .order("total_points", { ascending: false }).limit(1).single();
  console.log(`\n  Top bracket:`, top);
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const mode = FULL_MODE ? "Full Rescore" : FETCH_ONLY ? "Fetch Only" : "Incremental";
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  UPDATE & RESCORE — ${mode.padEnd(37)}║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  // MEN'S: fetch → score → done. Then women's.
  if (DO_MENS) {
    const { totalResults, insertedGames } = await fetchAndInsert("mens");
    if (FETCH_ONLY) {
      // nothing
    } else if (FULL_MODE) {
      await fullRescore("mens");
    } else if (insertedGames.length > 0) {
      await scoreNewGames("mens", insertedGames);
    } else {
      console.log(`  No new men's games to score.`);
    }
  }

  if (DO_WOMENS) {
    const { totalResults, insertedGames } = await fetchAndInsert("womens");
    if (FETCH_ONLY) {
      // nothing
    } else if (FULL_MODE) {
      await fullRescore("womens");
    } else if (insertedGames.length > 0) {
      await scoreNewGames("womens", insertedGames);
    } else {
      console.log(`  No new women's games to score.`);
    }
  }

  console.log("\n✓ DONE\n");
}

main().catch(err => {
  console.error("\nFatal:", err.message || err);
  process.exit(1);
});