/**
 * scripts/backfill-perfect-streak.ts
 *
 * Computes perfect_streak for every bracket and writes it to the new column
 * in Supabase. Picks are read from the source Parquet files in the sibling
 * ML repo (NOT from Supabase's picks column), per the migration plan.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts --gender mens
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts --dry-run
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Prereq: run supabase/migrations/001_add_perfect_streak.sql first.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";
import * as parquet from "@dsnp/parquetjs";

const ML_REPO = path.resolve(__dirname, "..", "..", "march-madness-bracket-predictor");
const SOURCES = {
  mens: {
    parquet:    path.join(ML_REPO, "outputs",   "brackets", "export_2026.parquet"),
    table:      "brackets",
    resultsTbl: "game_results",
  },
  womens: {
    parquet:    path.join(ML_REPO, "outputs_w", "brackets", "export_2026.parquet"),
    table:      "w_brackets",
    resultsTbl: "w_game_results",
  },
};

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const SELECTED_GENDER = (() => {
  const g = process.argv.find(a => a.startsWith("--gender="))?.split("=")[1]
        ?? (args.has("--gender") ? process.argv[process.argv.indexOf("--gender") + 1] : null);
  if (g && g !== "mens" && g !== "womens") {
    console.error(`Invalid --gender ${g}, expected "mens" or "womens"`); process.exit(1);
  }
  return g as "mens" | "womens" | null;
})();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function parsePicks(raw: any): number[] {
  if (typeof raw === "string") return raw.split(",").map(Number);
  if (Array.isArray(raw)) return raw.map(Number);
  if (raw && typeof raw === "object") {
    const len = Object.keys(raw).length;
    return Array.from({ length: len }, (_, i) => Number(raw[i] ?? 0));
  }
  return [];
}

async function loadDecidedByTime(resultsTable: string): Promise<number[]> {
  const { data, error } = await supabase
    .from(resultsTable)
    .select("game_idx, winner_id, completed_at")
    .order("completed_at", { ascending: true });
  if (error) throw new Error(`load results: ${error.message}`);
  return (data ?? []).map((r: any) => r.game_idx);
}

async function loadWinners(resultsTable: string): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from(resultsTable)
    .select("game_idx, winner_id");
  if (error) throw new Error(`load winners: ${error.message}`);
  return new Map((data ?? []).map((r: any) => [r.game_idx, r.winner_id]));
}

function computeStreak(picks: number[], decidedByTime: number[], winnerByIdx: Map<number, number>): number {
  let s = 0;
  for (let i = decidedByTime.length - 1; i >= 0; i--) {
    if (picks[decidedByTime[i]] === winnerByIdx.get(decidedByTime[i])) s++;
    else break;
  }
  return s;
}

async function backfillGender(gender: "mens" | "womens") {
  const cfg = SOURCES[gender];
  console.log(`\n=== ${gender.toUpperCase()} ===`);
  console.log(`Parquet: ${cfg.parquet}`);
  if (!fs.existsSync(cfg.parquet)) {
    console.error(`❌ Parquet not found at ${cfg.parquet}`);
    process.exit(1);
  }

  console.log(`Loading game_results from ${cfg.resultsTbl}...`);
  const decidedByTime = await loadDecidedByTime(cfg.resultsTbl);
  const winnerByIdx = await loadWinners(cfg.resultsTbl);
  console.log(`  ${decidedByTime.length} games decided`);
  if (decidedByTime.length === 0) {
    console.error(`❌ No game results — perfect_streak would be all 0. Aborting (you'd waste a write).`);
    return;
  }

  console.log(`Reading parquet → computing streaks (in memory)...`);
  const reader = await parquet.ParquetReader.openFile(cfg.parquet);
  const cursor = reader.getCursor();
  // bracket_hash → streak
  const streakByHash = new Map<string, number>();
  let row: any = null;
  let n = 0;
  while ((row = await cursor.next())) {
    const hash = String(row.bracket_hash);
    const picks = parsePicks(row.picks);
    if (picks.length !== 63) {
      console.warn(`  ⚠ ${hash}: picks length ${picks.length}, expected 63 — defaulting streak to 0`);
      streakByHash.set(hash, 0);
    } else {
      streakByHash.set(hash, computeStreak(picks, decidedByTime, winnerByIdx));
    }
    n++;
    if (n % 100000 === 0) process.stdout.write(`  ${n.toLocaleString()} computed\r`);
  }
  await reader.close();
  console.log(`  ${n.toLocaleString()} brackets total`);

  // Histogram for sanity
  const hist = new Map<number, number>();
  for (const v of streakByHash.values()) hist.set(v, (hist.get(v) ?? 0) + 1);
  console.log(`  streak histogram (top 10):`);
  Array.from(hist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([k, v]) => console.log(`    streak=${k}: ${v.toLocaleString()}`));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write to ${cfg.table}.perfect_streak. Skipping.`);
    return;
  }

  // Group by streak value, then update by hash batches.
  console.log(`Writing perfect_streak to ${cfg.table}...`);
  const byStreak = new Map<number, string[]>();
  for (const [hash, streak] of streakByHash) {
    if (!byStreak.has(streak)) byStreak.set(streak, []);
    byStreak.get(streak)!.push(hash);
  }

  const HASH_BATCH = 500;
  let totalWritten = 0;
  let writeErrors = 0;
  const t0 = Date.now();

  for (const [streak, hashes] of byStreak) {
    for (let i = 0; i < hashes.length; i += HASH_BATCH) {
      const chunk = hashes.slice(i, i + HASH_BATCH);
      const { error } = await supabase
        .from(cfg.table)
        .update({ perfect_streak: streak })
        .in("bracket_hash", chunk);
      if (error) {
        writeErrors++;
        console.warn(`  ⚠ batch fail streak=${streak} (${chunk.length}): ${error.message}`);
      } else {
        totalWritten += chunk.length;
      }
      if (totalWritten % 20000 === 0 && totalWritten > 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = Math.round(totalWritten / elapsed);
        process.stdout.write(`  ${totalWritten.toLocaleString()} written [${elapsed.toFixed(0)}s, ${rate}/s]\r`);
      }
    }
  }
  console.log(`\n  ✓ wrote ${totalWritten.toLocaleString()} rows, ${writeErrors} batch errors`);

  // Sanity check: count nulls remaining
  const { count: nullCount } = await supabase
    .from(cfg.table)
    .select("id", { count: "exact", head: true })
    .is("perfect_streak", null);
  console.log(`  perfect_streak NULL count after write: ${nullCount ?? 0}`);
}

async function main() {
  const targets: ("mens" | "womens")[] = SELECTED_GENDER ? [SELECTED_GENDER] : ["mens", "womens"];
  for (const g of targets) {
    await backfillGender(g);
  }
  console.log("\n✅ Backfill complete.");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
