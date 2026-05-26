/**
 * scripts/backfill-perfect-streak.ts
 *
 * Computes perfect_streak for every bracket and writes it via:
 *   1. Read picks from Parquet, compute streaks in memory
 *   2. Bulk-insert (id, streak) pairs into a temp staging table via COPY
 *   3. Single UPDATE FROM staging → brackets.perfect_streak
 *
 * Uses a direct Postgres connection (pg) via the Supabase pooler. URL is
 * parsed explicitly because some pg clients mishandle pooler usernames
 * containing a dot.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts --gender mens
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-perfect-streak.ts --dry-run
 *
 * Env required: DATABASE_URL (Supabase pooler connection string).
 * Prereq: run supabase/migrations/001_add_perfect_streak.sql first.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

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

const databaseUrl = process.env.DATABASE_URL!;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!databaseUrl) {
  console.error("❌ Missing DATABASE_URL in .env");
  process.exit(1);
}
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function pgClientFromUrl(url: string): Client {
  const parsed = new URL(url);
  return new Client({
    host: parsed.hostname,
    port: parseInt(parsed.port || "5432", 10),
    database: parsed.pathname.replace(/^\//, ""),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  });
}

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

async function loadHashToId(client: Client, table: string): Promise<Map<string, number>> {
  console.log(`  querying ${table} for hash→id (single query via direct PG)...`);
  const res = await client.query(`SELECT id, bracket_hash FROM ${table}`);
  const map = new Map<string, number>();
  for (const row of res.rows) map.set(String(row.bracket_hash), row.id);
  return map;
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
    console.error(`❌ No game results — perfect_streak would be all 0. Aborting.`);
    return;
  }

  console.log(`Connecting to Postgres...`);
  const client = pgClientFromUrl(databaseUrl);
  await client.connect();
  const stagingTable = `_streak_staging_${gender}_${Date.now()}`;

  try {
    console.log(`Loading hash→id mapping from ${cfg.table}...`);
    const hashToId = await loadHashToId(client, cfg.table);
    console.log(`  ${hashToId.size.toLocaleString()} brackets in DB`);

    console.log(`Reading parquet → computing streaks...`);
    const reader = await parquet.ParquetReader.openFile(cfg.parquet);
    const cursor = reader.getCursor();
    const streakById: Array<[number, number]> = [];
    let row: any = null;
    let n = 0;
    let missing = 0;
    while ((row = await cursor.next())) {
      const hash = String(row.bracket_hash);
      const id = hashToId.get(hash);
      if (id === undefined) { missing++; n++; continue; }
      const picks = parsePicks(row.picks);
      const streak = picks.length === 63 ? computeStreak(picks, decidedByTime, winnerByIdx) : 0;
      streakById.push([id, streak]);
      n++;
      if (n % 100000 === 0) process.stdout.write(`  ${n.toLocaleString()} computed\r`);
    }
    await reader.close();
    console.log(`  ${n.toLocaleString()} brackets read, ${streakById.length.toLocaleString()} matched to DB`);
    if (missing > 0) console.warn(`  ⚠ ${missing.toLocaleString()} parquet rows had no matching DB row`);

    const hist = new Map<number, number>();
    for (const [, v] of streakById) hist.set(v, (hist.get(v) ?? 0) + 1);
    console.log(`  streak histogram (top 10):`);
    Array.from(hist.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([k, v]) => console.log(`    streak=${k}: ${v.toLocaleString()}`));

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would write to ${cfg.table}.perfect_streak via COPY+UPDATE. Skipping.`);
      return;
    }

    console.log(`Writing perfect_streak to ${cfg.table} via staging table...`);
    const t0 = Date.now();
    await client.query(`CREATE TEMP TABLE ${stagingTable} (id INTEGER PRIMARY KEY, streak SMALLINT NOT NULL)`);
    console.log(`  staging table created, copying ${streakById.length.toLocaleString()} rows...`);

    const stream = client.query(copyFrom(`COPY ${stagingTable} (id, streak) FROM STDIN WITH (FORMAT csv)`));
    const source = Readable.from(
      (function* () {
        for (const [id, streak] of streakById) yield `${id},${streak}\n`;
      })()
    );
    await pipeline(source, stream);
    const copyMs = Date.now() - t0;
    console.log(`  COPY done in ${(copyMs / 1000).toFixed(1)}s`);

    const t1 = Date.now();
    console.log(`  running UPDATE FROM...`);
    const result = await client.query(
      `UPDATE ${cfg.table} t SET perfect_streak = s.streak FROM ${stagingTable} s WHERE t.id = s.id`
    );
    const updateMs = Date.now() - t1;
    console.log(`  UPDATE done in ${(updateMs / 1000).toFixed(1)}s — ${result.rowCount?.toLocaleString()} rows`);

    const nullRes = await client.query(`SELECT COUNT(*)::int AS c FROM ${cfg.table} WHERE perfect_streak IS NULL`);
    console.log(`  perfect_streak NULL count after write: ${nullRes.rows[0].c}`);

  } finally {
    await client.end();
  }
}

async function main() {
  const targets: ("mens" | "womens")[] = SELECTED_GENDER ? [SELECTED_GENDER] : ["mens", "womens"];
  for (const g of targets) await backfillGender(g);
  console.log("\n✅ Backfill complete.");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });