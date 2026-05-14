/**
 * scripts/export-picks-blob.ts
 *
 * Reads picks from the source Parquet files in the sibling ML repo,
 * writes a packed binary file (63 little-endian uint16 per record),
 * sorted by Supabase `id` ASC. Optionally uploads to Vercel Blob.
 *
 * Output file layout:
 *   record N (1-indexed) = bytes [(N-1)*126 .. (N-1)*126 + 125]
 *   each record = 63 picks × 2 bytes LE = 126 bytes
 *   total file size = N * 126
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/export-picks-blob.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/export-picks-blob.ts --gender mens
 *   npx ts-node --project tsconfig.scripts.json scripts/export-picks-blob.ts --no-upload
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (always)
 *   BLOB_READ_WRITE_TOKEN                                 (only if uploading)
 *
 * Side effect on success: prints the final blob URL. You must put it in
 * env vars PICKS_BLOB_URL_MENS / PICKS_BLOB_URL_WOMENS for the runtime.
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
    parquet: path.join(ML_REPO, "outputs",   "brackets", "export_2026.parquet"),
    table:   "brackets",
    binName: "picks_mens.bin",
  },
  womens: {
    parquet: path.join(ML_REPO, "outputs_w", "brackets", "export_2026.parquet"),
    table:   "w_brackets",
    binName: "picks_womens.bin",
  },
};

const RECORD_SIZE = 63 * 2; // 126 bytes
const OUT_DIR = path.join(__dirname, "..", "data");
const args = new Set(process.argv.slice(2));
const SKIP_UPLOAD = args.has("--no-upload");
const SELECTED_GENDER = (() => {
  const g = process.argv.find(a => a.startsWith("--gender="))?.split("=")[1]
        ?? (args.has("--gender") ? process.argv[process.argv.indexOf("--gender") + 1] : null);
  if (g && g !== "mens" && g !== "womens") {
    console.error(`Invalid --gender ${g}`); process.exit(1);
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

async function loadHashToId(table: string): Promise<Map<string, number>> {
  console.log(`Loading id↔hash map from ${table}...`);
  const map = new Map<string, number>();
  const BATCH = 50000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("id, bracket_hash")
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) map.set(r.bracket_hash, r.id);
    if (data.length < BATCH) break;
    from += BATCH;
    process.stdout.write(`  ${map.size.toLocaleString()} loaded\r`);
  }
  console.log(`  ${map.size.toLocaleString()} brackets in ${table}`);
  return map;
}

async function exportGender(gender: "mens" | "womens") {
  const cfg = SOURCES[gender];
  console.log(`\n=== ${gender.toUpperCase()} ===`);
  if (!fs.existsSync(cfg.parquet)) {
    console.error(`❌ Parquet not found at ${cfg.parquet}`); process.exit(1);
  }

  const hashToId = await loadHashToId(cfg.table);
  const N = hashToId.size;
  if (N === 0) { console.error(`❌ No rows in ${cfg.table}`); return; }
  const ids = Array.from(hashToId.values()).sort((a, b) => a - b);
  const minId = ids[0], maxId = ids[ids.length - 1];
  const dense = (maxId - minId + 1) === N && minId === 1;
  console.log(`  id range ${minId}..${maxId} (count=${N}, dense=${dense})`);

  // Build the buffer. Allocate maxId * 126 bytes (zero-padded for any gaps).
  const fileSize = maxId * RECORD_SIZE;
  console.log(`  Allocating ${(fileSize / 1024 / 1024).toFixed(1)} MB buffer...`);
  const buf = Buffer.alloc(fileSize);

  console.log(`  Streaming parquet → encoding picks...`);
  const reader = await parquet.ParquetReader.openFile(cfg.parquet);
  const cursor = reader.getCursor();
  let row: any = null;
  let rowsProcessed = 0;
  let rowsMissing = 0;
  let badPicks = 0;
  while ((row = await cursor.next())) {
    const hash = String(row.bracket_hash);
    const id = hashToId.get(hash);
    if (id === undefined) {
      rowsMissing++;
      rowsProcessed++;
      continue;
    }
    const picks = parsePicks(row.picks);
    if (picks.length !== 63) {
      badPicks++;
      rowsProcessed++;
      continue;
    }
    const offset = (id - 1) * RECORD_SIZE;
    for (let i = 0; i < 63; i++) {
      buf.writeUInt16LE(picks[i], offset + i * 2);
    }
    rowsProcessed++;
    if (rowsProcessed % 100000 === 0) {
      process.stdout.write(`  ${rowsProcessed.toLocaleString()} encoded\r`);
    }
  }
  await reader.close();
  console.log(`  ${rowsProcessed.toLocaleString()} parquet rows processed`);
  if (rowsMissing) console.warn(`  ⚠ ${rowsMissing.toLocaleString()} parquet rows had no matching id in ${cfg.table}`);
  if (badPicks)    console.warn(`  ⚠ ${badPicks.toLocaleString()} parquet rows had picks length != 63`);

  // Spot-check: pick 5 random rows and verify
  console.log(`  Spot-checking 5 random rows against Supabase...`);
  const sampleHashes = Array.from(hashToId.keys()).sort(() => Math.random() - 0.5).slice(0, 5);
  for (const h of sampleHashes) {
    const id = hashToId.get(h)!;
    const offset = (id - 1) * RECORD_SIZE;
    const decoded: number[] = [];
    for (let i = 0; i < 63; i++) decoded.push(buf.readUInt16LE(offset + i * 2));
    const { data: dbRow } = await supabase
      .from(cfg.table).select("picks").eq("bracket_hash", h).single();
    const dbPicks: number[] = (dbRow as any)?.picks ?? [];
    const same = dbPicks.length === 63 && decoded.every((v, i) => v === dbPicks[i]);
    console.log(`    id=${id} hash=${h}: ${same ? "OK" : "MISMATCH"}`);
    if (!same) {
      console.log(`      decoded:  ${decoded.slice(0, 8).join(",")}...`);
      console.log(`      supabase: ${dbPicks.slice(0, 8).join(",")}...`);
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, cfg.binName);
  fs.writeFileSync(outPath, buf);
  console.log(`  ✓ Wrote ${outPath} (${buf.byteLength.toLocaleString()} bytes)`);

  if (SKIP_UPLOAD) {
    console.log(`  --no-upload set, skipping Vercel Blob upload.`);
    console.log(`  Upload manually with: npx vercel blob put ${outPath} --pathname ${cfg.binName}`);
    return;
  }

  // Upload to Vercel Blob.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(`  ⚠ BLOB_READ_WRITE_TOKEN not set. Skipping upload.`);
    console.warn(`     Set it and re-run, or upload manually with the Vercel CLI:`);
    console.warn(`     npx vercel blob put ${outPath} --pathname ${cfg.binName}`);
    return;
  }

  let blobMod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    blobMod = require("@vercel/blob");
  } catch {
    console.warn(`  ⚠ @vercel/blob not installed. Run: npm install @vercel/blob`);
    return;
  }

  console.log(`  Uploading ${outPath} to Vercel Blob...`);
  const { url } = await blobMod.put(cfg.binName, buf, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  console.log(`  ✓ Uploaded → ${url}`);
  console.log(`\n  Add to your env vars:`);
  console.log(`    PICKS_BLOB_URL_${gender === "mens" ? "MENS" : "WOMENS"}=${url}`);
}

async function main() {
  const targets: ("mens" | "womens")[] = SELECTED_GENDER ? [SELECTED_GENDER] : ["mens", "womens"];
  for (const g of targets) await exportGender(g);
  console.log(`\n✅ Export complete.`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
