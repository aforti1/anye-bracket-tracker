/**
 * scripts/seed-db.ts
 *
 * Loads the exported parquet files into Supabase.
 * Run AFTER running export_brackets.py in the private repo and copying the files here.
 *
 * Usage:
 *   npx ts-node scripts/seed-db.ts
 *   npx ts-node scripts/seed-db.ts --season 2026
 *   npx ts-node scripts/seed-db.ts --dry-run        (validate without inserting)
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env before anything else
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";
import * as parquet from "@dsnp/parquetjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SEASON = parseInt(process.argv.find((a) => a.startsWith("--season="))?.split("=")[1] ?? "2026");
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 5000; // rows per insert — Supabase limit is ~10MB per request
const DATA_DIR = path.join(__dirname, "..", "data");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role key for bulk writes

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readParquet(filePath: string): Promise<any[]> {
  const reader = await parquet.ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const rows: any[] = [];
  let record = null;
  while ((record = await cursor.next())) {
    rows.push(record);
  }
  await reader.close();
  return rows;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeBigInt(obj: any): any {
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeBigInt);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitizeBigInt(v)]));
  }
  return obj;
}

async function batchInsert(
  table: string,
  rows: any[],
  label: string,
  onConflict?: string
) {
  let inserted = 0;
  const total = rows.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(sanitizeBigInt);
    const pct = Math.round(((i + batch.length) / total) * 100);

    if (!DRY_RUN) {
      let error;
      if (onConflict) {
        ({ error } = await supabase.from(table).upsert(batch, { onConflict }));
      } else {
        ({ error } = await supabase.from(table).insert(batch));
      }

      if (error) {
        console.error(`\n❌ Error inserting batch ${i / BATCH_SIZE + 1} into ${table}:`, error.message);
        throw error;
      }

      // Throttle slightly to avoid overwhelming Supabase
      if (i + BATCH_SIZE < total) await sleep(50);
    }

    inserted += batch.length;
    process.stdout.write(`\r  ${label}: ${inserted.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
  }
  console.log(); // newline after progress
  return inserted;
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------
async function seedTournamentTeams(season: number) {
  const filePath = path.join(DATA_DIR, `tournament_teams_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ ${filePath} not found — skipping teams`);
    return;
  }

  console.log(`\n📋 Seeding tournament_teams...`);
  const rows = await readParquet(filePath);
  console.log(`  ${rows.length} teams loaded from parquet`);

  await batchInsert("tournament_teams", rows, "teams", "team_id");
  console.log(`  ✓ tournament_teams seeded`);
}

async function seedGameNodes(season: number) {
  const filePath = path.join(DATA_DIR, `game_nodes_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ ${filePath} not found — skipping game nodes`);
    return;
  }

  console.log(`\n🌳 Seeding game_nodes...`);
  const rows = await readParquet(filePath);
  console.log(`  ${rows.length} game nodes loaded from parquet`);

  await batchInsert("game_nodes", rows, "nodes", "game_idx");
  console.log(`  ✓ game_nodes seeded`);
}

async function seedBrackets(season: number) {
  const filePath = path.join(DATA_DIR, `export_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${filePath} not found`);
    console.error(`   Run: python scripts/export_brackets.py --season ${season}`);
    console.error(`   Then copy export_${season}.parquet to bracket-tracker/data/`);
    process.exit(1);
  }

  console.log(`\n🏀 Seeding brackets...`);
  const raw = await readParquet(filePath);
  console.log(`  ${raw.length.toLocaleString()} brackets loaded from parquet`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would insert ${raw.length.toLocaleString()} rows into brackets`);
    console.log(`  Sample row:`, JSON.stringify(raw[0]).substring(0, 200));
    return;
  }

  // Transform: convert picks from Buffer/array to postgres smallint array literal
  function toPicksArray(raw: any): string {
    // picks is stored as CSV string in parquet e.g. "1234,5678,..."
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return raw.map(Number).join(",");
    if (raw && typeof raw === "object") {
      const len = Object.keys(raw).length;
      return Array.from({ length: len }, (_, i) => Number(raw[i] ?? 0)).join(",");
    }
    return new Array(63).fill(0).join(",");
  }

  const rows = raw.map((r: any) => ({
    bracket_hash:  String(r.bracket_hash),
    picks:         toPicksArray(r.picks),
    champion_id:   r.champion_id != null ? Number(r.champion_id) : null,
    champion_name: r.champion_name ?? null,
    champion_seed: r.champion_seed != null ? Number(r.champion_seed) : null,
    log_prob:      r.log_prob != null ? Number(r.log_prob) : null,
    upset_count:   r.upset_count != null ? Number(r.upset_count) : 0,
    total_points:  0,
    correct_picks: 0,
    games_decided: 0,
    accuracy:      0,
    rank:          null,
  }));

  await batchInsert("brackets", rows, "brackets");

  // Update metadata
  await supabase
    .from("metadata")
    .upsert({ key: "total_brackets", value: String(rows.length) });

  console.log(`  ✓ ${rows.length.toLocaleString()} brackets seeded`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Bracket Tracker — Database Seed`);
  console.log(`  Season: ${SEASON}`);
  if (DRY_RUN) console.log(`  ⚠ DRY RUN — no data will be written`);
  console.log(`${"=".repeat(60)}`);

  // Confirm data dir exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`\n  Created data/ directory`);
  }

  // Test Supabase connection
  console.log(`\n🔌 Testing Supabase connection...`);
  const { error: pingError } = await supabase.from("metadata").select("key").limit(1);
  if (pingError) {
    console.error(`❌ Cannot reach Supabase: ${pingError.message}`);
    console.error(`   Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
    process.exit(1);
  }
  console.log(`  ✓ Connected`);

  // Seed in dependency order
  await seedTournamentTeams(SEASON);
  await seedGameNodes(SEASON);
  await seedBrackets(SEASON);

  // Final metadata update
  if (!DRY_RUN) {
    await supabase
      .from("metadata")
      .upsert({ key: "last_updated", value: new Date().toISOString() });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ✅ Seed complete!`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
