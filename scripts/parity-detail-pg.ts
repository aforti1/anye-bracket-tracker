/**
 * scripts/parity-detail-pg.ts
 *
 * Same as parity-detail.ts but uses direct Postgres connection for everything,
 * since the Supabase HTTP API is restricted while DB is over quota.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-detail-pg.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-detail-pg.ts --n 1000 --gender womens
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const N = parseInt(process.argv.find(a => a.startsWith("--n="))?.split("=")[1] ?? "1000");
const args = new Set(process.argv.slice(2));
const SELECTED_GENDER = (() => {
  const g = process.argv.find(a => a.startsWith("--gender="))?.split("=")[1]
        ?? (args.has("--gender") ? process.argv[process.argv.indexOf("--gender") + 1] : null);
  if (g && g !== "mens" && g !== "womens") {
    if (g) { console.error(`Invalid --gender ${g}`); process.exit(1); }
  }
  return g as "mens" | "womens" | null;
})();

const databaseUrl = process.env.DATABASE_URL!;
if (!databaseUrl) { console.error("❌ Missing DATABASE_URL"); process.exit(1); }

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
  if (res.status !== 206 && res.status !== 200) throw new Error(`blob status=${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== RECORD_SIZE) throw new Error(`blob got ${buf.byteLength} bytes`);
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
  if (!blobUrl) { console.error(`❌ Missing blob URL for ${gender}`); process.exit(1); }

  console.log(`\n=== ${gender.toUpperCase()} (${table}) ===`);

  const client = pgClientFromUrl(databaseUrl);
  await client.connect();

  try {
    const rangeRes = await client.query(`SELECT MIN(id)::int AS min_id, MAX(id)::int AS max_id, COUNT(*)::int AS cnt FROM ${table}`);
    const { min_id, max_id, cnt } = rangeRes.rows[0];
    console.log(`  id range ${min_id}..${max_id}, total=${cnt.toLocaleString()}`);
    if (!cnt) return;

    const ids = new Set<number>();
    while (ids.size < n) ids.add(min_id + Math.floor(Math.random() * (max_id - min_id + 1)));
    const idList = Array.from(ids);

    // Fetch picks from Postgres in batches
    const supaMap = new Map<number, number[]>();
    const BATCH = 1000;
    for (let i = 0; i < idList.length; i += BATCH) {
      const slice = idList.slice(i, i + BATCH);
      const res = await client.query(
        `SELECT id, picks FROM ${table} WHERE id = ANY($1::int[])`,
        [slice]
      );
      for (const row of res.rows) supaMap.set(row.id, row.picks ?? []);
    }

    let ok = 0, mismatches = 0, missing = 0;
    const failures: number[] = [];

    for (const id of idList) {
      const dbPicks = supaMap.get(id);
      if (!dbPicks || dbPicks.length === 0) { missing++; continue; }
      let blobPicks: number[];
      try {
        blobPicks = await picksFromBlob(blobUrl, id);
      } catch (err: any) {
        console.warn(`  id=${id} blob fetch failed: ${err.message}`);
        failures.push(id);
        continue;
      }
      if (dbPicks.length !== 63 || blobPicks.length !== 63) {
        mismatches++; failures.push(id); continue;
      }
      let same = true;
      for (let i = 0; i < 63; i++) if (dbPicks[i] !== blobPicks[i]) { same = false; break; }
      if (same) ok++;
      else { mismatches++; failures.push(id); }
    }

    console.log(`  checked=${idList.length}, ok=${ok}, mismatches=${mismatches}, missing-in-db=${missing}`);
    if (failures.length) {
      console.log(`  failure ids (first 10): ${failures.slice(0, 10).join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const targets: ("mens" | "womens")[] = SELECTED_GENDER ? [SELECTED_GENDER] : ["mens", "womens"];
  for (const g of targets) await checkGender(g, N);
  console.log(`\n${process.exitCode ? "❌ PARITY FAILED" : "✅ Detail parity OK"}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });