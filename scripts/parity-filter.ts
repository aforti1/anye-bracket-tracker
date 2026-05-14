/**
 * scripts/parity-filter.ts
 *
 * For each gender, generates K random pick-filter predicates and compares:
 *   - Existing RPC: get_filtered_bracket_ids / w_get_filtered_bracket_ids
 *     (i.e. the pre-migration code path)
 *   - New scan: in-process equivalent of lib/picks-filter-scan.ts, using
 *     the local data/picks_<gender>.bin file (preferred) or the deployed
 *     PICKS_BLOB_URL_* via Range fetches (slower).
 *
 * Asserts the two return identical id arrays in the same order.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-filter.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/parity-filter.ts --k 20 --max-results 50000
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   Either local data/picks_<gender>.bin OR PICKS_BLOB_URL_<GENDER>.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";

const K = parseInt(process.argv.find(a => a.startsWith("--k="))?.split("=")[1] ?? "20");
const MAX_RESULTS_FOR_DETAILED_DIFF = parseInt(process.argv.find(a => a.startsWith("--max-results="))?.split("=")[1] ?? "50000");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const RECORD_SIZE = 126;
const ALLOWED_SORTS = ["bracket_hash","champion_name","total_points","correct_picks","accuracy","log_prob","upset_count","rank","perfect_streak"];

type Gender = "mens" | "womens";

const TABLE = (g: Gender) => g === "mens" ? "brackets" : "w_brackets";
const GAME_NODES = (g: Gender) => g === "mens" ? "game_nodes" : "w_game_nodes";
const GAME_RESULTS = (g: Gender) => g === "mens" ? "game_results" : "w_game_results";
const RPC_NAME = (g: Gender) => g === "mens" ? "get_filtered_bracket_ids" : "w_get_filtered_bracket_ids";
const BIN_NAME = (g: Gender) => g === "mens" ? "picks_mens.bin" : "picks_womens.bin";

// ── Picks source: prefer local file, fall back to HTTP Range ──────────
type PicksSource = {
  pickAt: (id: number, gameIdx: number) => Promise<number>;
  preload?: (ids: number[]) => Promise<void>;
};

function localFileSource(filePath: string): PicksSource {
  console.log(`  Loading ${filePath} into memory...`);
  const buf = fs.readFileSync(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    pickAt: async (id, gi) => view.getUint16((id - 1) * RECORD_SIZE + gi * 2, true),
  };
}

function httpRangeSource(blobUrl: string): PicksSource {
  const cache = new Map<number, number[]>();
  return {
    pickAt: async (id, gi) => {
      let arr = cache.get(id);
      if (!arr) {
        const start = (id - 1) * RECORD_SIZE;
        const end = start + RECORD_SIZE - 1;
        const res = await fetch(blobUrl, { headers: { Range: `bytes=${start}-${end}` } });
        const ab = await res.arrayBuffer();
        const v = new DataView(ab);
        arr = new Array<number>(63);
        for (let i = 0; i < 63; i++) arr[i] = v.getUint16(i * 2, true);
        cache.set(id, arr);
      }
      return arr[gi];
    },
  };
}

function getPicksSource(gender: Gender): PicksSource {
  const localPath = path.join(__dirname, "..", "data", BIN_NAME(gender));
  if (fs.existsSync(localPath)) return localFileSource(localPath);
  const url = gender === "mens" ? process.env.PICKS_BLOB_URL_MENS : process.env.PICKS_BLOB_URL_WOMENS;
  if (!url) {
    console.error(`❌ No local ${BIN_NAME(gender)} and no PICKS_BLOB_URL_${gender === "mens" ? "MENS" : "WOMENS"}`);
    process.exit(1);
  }
  console.log(`  Using HTTP Range against ${url}`);
  return httpRangeSource(url);
}

// ── Predicate generation ──────────────────────────────────────────────
type Cond = { game_idx: number; team_id: number; won: boolean };

async function generatePredicates(gender: Gender, k: number): Promise<{ conditions: Cond[] }[]> {
  // Prefer real winners (always non-empty result for won=true). Mix in some won=false.
  const { data: results } = await supabase
    .from(GAME_RESULTS(gender)).select("game_idx, winner_id");
  const real = (results ?? []) as { game_idx: number; winner_id: number }[];

  const { data: nodes } = await supabase
    .from(GAME_NODES(gender)).select("game_idx, round, team_a_id, team_b_id");
  const r64 = (nodes ?? []).filter((n: any) => n.round === "round_64") as any[];

  const out: { conditions: Cond[] }[] = [];
  for (let i = 0; i < k; i++) {
    const choice = Math.random();
    if (choice < 0.5 && real.length > 0) {
      // Single won=true on a real winner
      const r = real[Math.floor(Math.random() * real.length)];
      out.push({ conditions: [{ game_idx: r.game_idx, team_id: r.winner_id, won: true }] });
    } else if (choice < 0.8 && r64.length > 0) {
      // Single won=false on a R64 participant
      const n = r64[Math.floor(Math.random() * r64.length)];
      const teamId = Math.random() < 0.5 ? n.team_a_id : n.team_b_id;
      out.push({ conditions: [{ game_idx: n.game_idx, team_id: teamId, won: false }] });
    } else if (real.length >= 2) {
      // Two-condition AND on real winners
      const a = real[Math.floor(Math.random() * real.length)];
      let b = real[Math.floor(Math.random() * real.length)];
      while (b.game_idx === a.game_idx) b = real[Math.floor(Math.random() * real.length)];
      out.push({
        conditions: [
          { game_idx: a.game_idx, team_id: a.winner_id, won: true },
          { game_idx: b.game_idx, team_id: b.winner_id, won: true },
        ],
      });
    } else {
      i--; // try again
    }
  }
  return out;
}

// ── Scan implementation (mirrors lib/picks-filter-scan.ts) ────────────
async function scanIds(
  gender: Gender,
  conditions: Cond[],
  src: PicksSource,
  nodeMap: Map<number, any>,
): Promise<number[]> {
  const resolved = conditions.map(c => {
    const node = nodeMap.get(c.game_idx);
    return {
      game_idx: c.game_idx, team_id: c.team_id, won: c.won,
      isR64: node?.round === "round_64",
      r64TeamA: node?.team_a_id ?? null,
      r64TeamB: node?.team_b_id ?? null,
      source_a: node?.source_a ?? null,
      source_b: node?.source_b ?? null,
    };
  });

  async function matches(id: number): Promise<boolean> {
    for (const c of resolved) {
      const pickAtGame = await src.pickAt(id, c.game_idx);
      if (c.won) { if (pickAtGame !== c.team_id) return false; continue; }
      if (pickAtGame === c.team_id) return false;
      let reached = false;
      if (c.isR64) {
        reached = c.r64TeamA === c.team_id || c.r64TeamB === c.team_id;
      } else {
        const a = c.source_a != null ? await src.pickAt(id, c.source_a) : 0;
        const b = c.source_b != null ? await src.pickAt(id, c.source_b) : 0;
        reached = a === c.team_id || b === c.team_id;
      }
      if (!reached) return false;
    }
    return true;
  }

  // Sort order: total_points DESC, then total_points/correct_picks tiebreaks.
  // Mirror the route's default sort.
  const matched: number[] = [];
  const BATCH = 50000;
  let from = 0;
  while (true) {
    let q: any = supabase.from(TABLE(gender)).select("id");
    q = q.order("total_points", { ascending: false });
    q = q.order("correct_picks", { ascending: false });
    q = q.range(from, from + BATCH - 1);
    const { data, error } = await q;
    if (error) throw new Error(`scan: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const id = (row as any).id as number;
      if (await matches(id)) matched.push(id);
    }
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return matched;
}

// ── Main ───────────────────────────────────────────────────────────────
async function checkGender(gender: Gender, k: number) {
  console.log(`\n=== ${gender.toUpperCase()} ===`);
  const src = getPicksSource(gender);
  const { data: nodes } = await supabase.from(GAME_NODES(gender))
    .select("game_idx, round, team_a_id, team_b_id, source_a, source_b").order("game_idx");
  const nodeMap = new Map((nodes ?? []).map((n: any) => [n.game_idx, n]));

  const predicates = await generatePredicates(gender, k);
  console.log(`  Generated ${predicates.length} random predicates`);

  let allOk = true;
  for (let i = 0; i < predicates.length; i++) {
    const { conditions } = predicates[i];
    const condsForRpc = conditions.map(c => {
      const node = nodeMap.get(c.game_idx);
      return {
        game_idx: c.game_idx, team_id: c.team_id, won: c.won,
        source_a: node?.source_a ?? null, source_b: node?.source_b ?? null,
      };
    });
    const t0 = Date.now();
    const { data: rpcRes, error: rpcErr } = await supabase.rpc(RPC_NAME(gender), {
      p_conditions: condsForRpc,
      p_champion_id: null, p_min_upsets: null, p_max_upsets: null,
      p_sort_col: "total_points", p_sort_asc: false,
    }).limit(MAX_RESULTS_FOR_DETAILED_DIFF);
    const rpcTime = Date.now() - t0;
    if (rpcErr) { console.error(`  [${i+1}] RPC failed: ${rpcErr.message}`); allOk = false; continue; }
    const rpcIds = ((rpcRes ?? []) as any[]).map(r => r.id);

    const t1 = Date.now();
    const scanIdsResult = await scanIds(gender, conditions, src, nodeMap);
    const scanTime = Date.now() - t1;

    const same =
      rpcIds.length === scanIdsResult.length &&
      rpcIds.every((id, idx) => id === scanIdsResult[idx]);
    const tag = same ? "OK" : "MISMATCH";
    const condStr = conditions.map(c => `g${c.game_idx}/${c.team_id}/${c.won?"W":"L"}`).join("&");
    console.log(`  [${i+1}/${predicates.length}] ${tag} ${condStr} → rpc=${rpcIds.length} (${rpcTime}ms) scan=${scanIdsResult.length} (${scanTime}ms)`);
    if (!same) {
      allOk = false;
      // Show diff sample
      const rpcSet = new Set(rpcIds);
      const scanSet = new Set(scanIdsResult);
      const onlyRpc = rpcIds.filter(id => !scanSet.has(id)).slice(0, 5);
      const onlyScan = scanIdsResult.filter(id => !rpcSet.has(id)).slice(0, 5);
      if (onlyRpc.length) console.log(`     only-in-rpc:  ${onlyRpc.join(", ")}`);
      if (onlyScan.length) console.log(`     only-in-scan: ${onlyScan.join(", ")}`);
      if (onlyRpc.length === 0 && onlyScan.length === 0) {
        // Same set, different order
        const firstDiff = rpcIds.findIndex((id, idx) => id !== scanIdsResult[idx]);
        console.log(`     same set, ORDER differs at index ${firstDiff}`);
      }
    }
  }

  if (!allOk) process.exitCode = 1;
}

async function main() {
  await checkGender("mens", K);
  await checkGender("womens", K);
  console.log(`\n${process.exitCode ? "❌ FILTER PARITY FAILED" : "✅ Filter parity OK"}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
