/**
 * scripts/verify-streak.ts
 *
 * Sanity-checks the streak computation by:
 *   1. Picking N random brackets from Supabase
 *   2. Reading their picks from the live picks column (still present)
 *   3. Computing perfect_streak using the same algorithm as backfill-perfect-streak.ts
 *   4. Printing each bracket's id, hash, and computed streak so you can spot-check
 *      against the live site
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/verify-streak.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/verify-streak.ts --gender mens --n 20
 *
 * No writes. Safe to run any time.
 */

import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";

const SOURCES = {
  mens:   { table: "brackets",   resultsTbl: "game_results",   urlPath: "/mens/brackets"   },
  womens: { table: "w_brackets", resultsTbl: "w_game_results", urlPath: "/womens/brackets" },
};

const args = process.argv.slice(2);
const SELECTED_GENDER = (() => {
  const i = args.indexOf("--gender");
  if (i >= 0 && args[i + 1]) {
    const g = args[i + 1];
    if (g !== "mens" && g !== "womens") {
      console.error(`Invalid --gender ${g}, expected "mens" or "womens"`); process.exit(1);
    }
    return g as "mens" | "womens";
  }
  return null;
})();
const N = (() => {
  const i = args.indexOf("--n");
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
  return 20;
})();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function parsePicks(raw: any): number[] {
  if (typeof raw === "string") return raw.split(",").map(Number);
  if (Array.isArray(raw)) return raw.map(Number);
  return [];
}

function computeStreak(picks: number[], decidedByTime: number[], winnerByIdx: Map<number, number>): number {
  let s = 0;
  for (let i = decidedByTime.length - 1; i >= 0; i--) {
    if (picks[decidedByTime[i]] === winnerByIdx.get(decidedByTime[i])) s++;
    else break;
  }
  return s;
}

async function verifyGender(gender: "mens" | "womens") {
  const cfg = SOURCES[gender];
  console.log(`\n=== ${gender.toUpperCase()} ===`);

  // Load game results
  const { data: results, error: rErr } = await supabase
    .from(cfg.resultsTbl)
    .select("game_idx, winner_id, completed_at")
    .order("completed_at", { ascending: true });
  if (rErr) { console.error(`load results: ${rErr.message}`); return; }
  if (!results || results.length === 0) {
    console.error(`No game results found in ${cfg.resultsTbl}.`); return;
  }
  const decidedByTime = results.map((r: any) => r.game_idx);
  const winnerByIdx = new Map(results.map((r: any) => [r.game_idx, r.winner_id]));
  const mostRecentGameIdx = decidedByTime[decidedByTime.length - 1];
  const mostRecentWinnerId = winnerByIdx.get(mostRecentGameIdx);
  console.log(`Games decided: ${decidedByTime.length}`);
  console.log(`Most recent game: game_idx=${mostRecentGameIdx}, winner_id=${mostRecentWinnerId}`);

  // Pull total row count to pick random ids
  const { count, error: cErr } = await supabase
    .from(cfg.table)
    .select("id", { count: "exact", head: true });
  if (cErr || !count) { console.error(`count: ${cErr?.message}`); return; }

  // Pick N random ids
  const randomIds: number[] = [];
  const seen = new Set<number>();
  while (randomIds.length < N) {
    const r = 1 + Math.floor(Math.random() * count);
    if (!seen.has(r)) { seen.add(r); randomIds.push(r); }
  }

  // Fetch those rows with picks
  const { data: rows, error: bErr } = await supabase
    .from(cfg.table)
    .select("id, bracket_hash, picks, total_points, correct_picks")
    .in("id", randomIds);
  if (bErr || !rows) { console.error(`fetch rows: ${bErr?.message}`); return; }

  console.log(`\nSampled ${rows.length} brackets:\n`);
  console.log(`  ${"id".padStart(7)}  ${"hash".padEnd(10)}  pts  correct  streak  most_recent_pick  matched_winner?`);
  console.log(`  ${"-".repeat(75)}`);

  for (const row of rows.sort((a: any, b: any) => a.id - b.id)) {
    const picks = parsePicks(row.picks);
    const streak = computeStreak(picks, decidedByTime, winnerByIdx);
    const pickForMostRecent = picks[mostRecentGameIdx];
    const matched = pickForMostRecent === mostRecentWinnerId ? "✓" : "✗";
    console.log(
      `  ${String(row.id).padStart(7)}  ${String(row.bracket_hash).padEnd(10)}  ` +
      `${String(row.total_points).padStart(3)}  ` +
      `${String(row.correct_picks).padStart(7)}  ` +
      `${String(streak).padStart(6)}  ` +
      `${String(pickForMostRecent).padStart(16)}  ${matched}`
    );
  }

  console.log(`\nTo verify: open one of these on your live site:`);
  for (const row of rows.slice(0, 3)) {
    console.log(`  https://<your-site>${cfg.urlPath}/${row.bracket_hash}`);
  }
  console.log(`Compare the "perfect_streak" shown on the site to the "streak" column above.`);
  console.log(`The "matched_winner?" column is a sanity check: ✗ means this bracket missed the`);
  console.log(`most recent game, which forces streak to 0. ✓ means streak should be ≥ 1.`);
}

async function main() {
  const targets: ("mens" | "womens")[] = SELECTED_GENDER ? [SELECTED_GENDER] : ["mens", "womens"];
  for (const g of targets) await verifyGender(g);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });