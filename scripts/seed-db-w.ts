/**
 * scripts/seed-db-w.ts
 *
 * Loads the exported women's parquet files into Supabase w_ tables.
 * Run AFTER:
 *   1. Running export_brackets.py in the private repo (with women's DB)
 *   2. Copying the parquet files here with w_ prefix
 *   3. Running schema_w.sql in the Supabase SQL Editor
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/seed-db-w.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/seed-db-w.ts --dry-run
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
// __dirname is available natively in CJS mode

dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";
import * as parquet from "@dsnp/parquetjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SEASON = parseInt(process.argv.find((a) => a.startsWith("--season="))?.split("=")[1] ?? "2026");
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 5000;
const DATA_DIR = path.join(__dirname, "..", "data");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

      if (i + BATCH_SIZE < total) await sleep(50);
    }

    inserted += batch.length;
    process.stdout.write(`\r  ${label}: ${inserted.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
  }
  console.log();
  return inserted;
}

// ---------------------------------------------------------------------------
// Seed functions — all write to w_ prefixed tables
// ---------------------------------------------------------------------------
async function seedTournamentTeams(season: number) {
  const filePath = path.join(DATA_DIR, `w_tournament_teams_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ ${filePath} not found — skipping teams`);
    return;
  }

  console.log(`\n📋 Seeding w_tournament_teams...`);
  const rows = await readParquet(filePath);
  console.log(`  ${rows.length} teams loaded from parquet`);

  await batchInsert("w_tournament_teams", rows, "teams", "team_id");
  console.log(`  ✓ w_tournament_teams seeded`);
}

async function seedGameNodes(season: number) {
  const filePath = path.join(DATA_DIR, `w_game_nodes_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ ${filePath} not found — skipping game nodes`);
    return;
  }

  console.log(`\n🌳 Seeding w_game_nodes...`);
  const rows = await readParquet(filePath);
  console.log(`  ${rows.length} game nodes loaded from parquet`);

  await batchInsert("w_game_nodes", rows, "nodes", "game_idx");
  console.log(`  ✓ w_game_nodes seeded`);
}

async function seedBrackets(season: number) {
  const filePath = path.join(DATA_DIR, `w_export_${season}.parquet`);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${filePath} not found`);
    console.error(`   Run: python scripts/export_brackets.py --season ${season}`);
    console.error(`   Then copy as w_export_${season}.parquet to bracket-tracker/data/`);
    process.exit(1);
  }

  console.log(`\n🏀 Seeding w_brackets...`);
  const raw = await readParquet(filePath);
  console.log(`  ${raw.length.toLocaleString()} brackets loaded from parquet`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would insert ${raw.length.toLocaleString()} rows into w_brackets`);
    console.log(`  Sample row:`, JSON.stringify(raw[0]).substring(0, 200));
    return;
  }

  function toPicksArray(raw: any): string {
    if (typeof raw === "string") {
      // Already CSV — wrap in braces for Postgres
      if (!raw.startsWith("{")) return `{${raw}}`;
      return raw;
    }
    if (Array.isArray(raw)) return `{${raw.map(Number).join(",")}}`;
    if (raw && typeof raw === "object") {
      const len = Object.keys(raw).length;
      return `{${Array.from({ length: len }, (_, i) => Number(raw[i] ?? 0)).join(",")}}`;
    }
    return `{${new Array(63).fill(0).join(",")}}`;
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

  await batchInsert("w_brackets", rows, "brackets");

  // Update women's metadata
  await supabase
    .from("w_metadata")
    .upsert({ key: "total_brackets", value: String(rows.length) });

  console.log(`  ✓ ${rows.length.toLocaleString()} women's brackets seeded`);
}

async function seedChampionCounts(season: number) {
  const filePath = path.join(DATA_DIR, `w_export_${season}.parquet`);
  if (!fs.existsSync(filePath)) return;

  console.log(`\n👑 Computing w_champion_counts...`);
  const raw = await readParquet(filePath);

  // Count champions
  const counts = new Map<number, { name: string; seed: number; count: number }>();
  for (const r of raw) {
    const id = r.champion_id != null ? Number(r.champion_id) : null;
    if (id == null) continue;
    const existing = counts.get(id);
    if (existing) {
      existing.count++;
    } else {
      counts.set(id, {
        name: r.champion_name ?? "Unknown",
        seed: r.champion_seed != null ? Number(r.champion_seed) : 0,
        count: 1,
      });
    }
  }

  const rows = Array.from(counts.entries()).map(([id, info]) => ({
    champion_id: id,
    champion_name: info.name,
    champion_seed: info.seed,
    count: info.count,
  }));

  if (!DRY_RUN) {
    await batchInsert("w_champion_counts", rows, "champion_counts", "champion_id");
  }

  console.log(`  ✓ ${rows.length} unique women's champions`);

  // Also store unique_champions in metadata
  await supabase
    .from("w_metadata")
    .upsert({ key: "unique_champions", value: String(rows.length) });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Women's Bracket Tracker — Database Seed`);
  console.log(`  Season: ${SEASON}`);
  if (DRY_RUN) console.log(`  ⚠ DRY RUN — no data will be written`);
  console.log(`${"=".repeat(60)}`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`\n  Created data/ directory`);
  }

  // Test connection using women's metadata table
  console.log(`\n🔌 Testing Supabase connection...`);
  const { error: pingError } = await supabase.from("w_metadata").select("key").limit(1);
  if (pingError) {
    console.error(`❌ Cannot reach Supabase w_metadata: ${pingError.message}`);
    console.error(`   Did you run schema_w.sql in the Supabase SQL Editor?`);
    process.exit(1);
  }
  console.log(`  ✓ Connected`);

  // Seed in dependency order
  await seedTournamentTeams(SEASON);
  await seedGameNodes(SEASON);
  await seedBrackets(SEASON);
  await seedChampionCounts(SEASON);

  // Final metadata update
  if (!DRY_RUN) {
    await supabase
      .from("w_metadata")
      .upsert({ key: "last_updated", value: new Date().toISOString() });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ✅ Women's seed complete!`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
