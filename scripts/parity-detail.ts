/**
 * scripts/parity-detail.ts
 *
 * Picks N random brackets per gender. For each, fetches picks from BOTH:
 *   - Supabase (the picks column)
 *   - Vercel Blob (HTTP Range)
 * and asserts byte-for-byte equality.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-detail.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-detail.ts --n 1000
 *
 * Env required:
 *   DATABASE_URL
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PICKS_BLOB_URL_MENS, PICKS_BLOB_URL_WOMENS
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";

const N = parseInt(process.argv.find(a => a.startsWith("--n="))?.split("=")[1] ?? "1000");

const databaseUrl = process.env.DATABASE_URL!;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const RECORD_SIZE = 126;

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

async function picksFromBlob(url: string, id: number): Promise<number[]> {
  const start = (id - 1) * RECORD_SIZE;
  const end = start + RECORD_SIZE - 1;
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`blob status=${res.status} for id=${id}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== RECORD_SIZE) {
    throw new Error(`blob got ${buf.byteLength} bytes for id=${id}, expected ${RECORD_SIZE}`);
  }
  const view = new DataView(buf);
  const out = new Array<number>(63);
  for (let i = 0; i < 63; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

async function checkGender(gender: "mens" | "womens", n: number) {
  const table = gender === "mens" ? "brackets" : "w_brackets";
  const blobUrl = gender === "mens"
    ? process.env.PICKS_BLOB_URL_MENS
    : process.env.PICKS_BLOB_URL_WOMENS;
  if (!blobUrl) {
    console.error(`❌ Missing PICKS_BLOB_URL_${gender === "mens" ? "MENS" : "WOMENS"}`);
    process.exit(1);
  }

  console.log(`\n=== ${gender.toUpperCase()} (${table}) ===`);

  // Get id range via direct PG (HTTP API was returning no rows here)
  const client = pgClientFromUrl(databaseUrl);
  await client.connect();
  let idList: number[];
  try {
    const res = await client.query(`SELECT MIN(id)::int AS min_id, MAX(id)::int AS max_id, COUNT(*)::int AS cnt FROM ${table}`);
    const { min_id, max_id, cnt } = res.rows[0];
    console.log(`  id range ${min_id}..${max_id}, total=${cnt.toLocaleString()}`);
    if (!cnt) { console.error("  no rows"); return; }

    // Pick n random ids in [min_id..max_id]
    const ids = new Set<number>();
    while (ids.size < n) {
      const r = min_id + Math.floor(Math.random() * (max_id - min_id + 1));
      ids.add(r);
    }
    idList = Array.from(ids);
  } finally {
    await client.end();
  }

  // Fetch picks from Supabase in batches
  const supaMap = new Map<number, number[]>();
  const BATCH = 500;
  for (let i = 0; i < idList.length; i += BATCH) {
    const slice = idList.slice(i, i + BATCH);
    const { data, error } = await supabase.from(table).select("id, picks").in("id", slice);
    if (error) throw new Error(`supabase fetch: ${error.message}`);
    for (const row of (data ?? []) as any[]) supaMap.set(row.id, row.picks ?? []);
  }

  let ok = 0, mismatches = 0, missing = 0;
  const failures: number[] = [];

  for (const id of idList) {
    const supaPicks = supaMap.get(id);
    if (!supaPicks || supaPicks.length === 0) { missing++; continue; }
    let blobPicks: number[];
    try {
      blobPicks = await picksFromBlob(blobUrl, id);
    } catch (err: any) {
      console.warn(`  id=${id} blob fetch failed: ${err.message}`);
      failures.push(id);
      continue;
    }
    if (supaPicks.length !== 63 || blobPicks.length !== 63) {
      mismatches++;
      failures.push(id);
      continue;
    }
    let same = true;
    for (let i = 0; i < 63; i++) if (supaPicks[i] !== blobPicks[i]) { same = false; break; }
    if (same) ok++;
    else { mismatches++; failures.push(id); }
  }

  console.log(`  checked=${idList.length}, ok=${ok}, mismatches=${mismatches}, missing-in-supabase=${missing}`);
  if (failures.length) {
    console.log(`  failure ids (first 10): ${failures.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
  }
}

async function main() {
  await checkGender("mens", N);
  await checkGender("womens", N);
  console.log(`\n${process.exitCode ? "❌ PARITY FAILED" : "✅ Detail parity OK"}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });