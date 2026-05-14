/**
 * scripts/parity-filter.ts
 *
 * For each gender, generates K random pick-filter predicates and compares:
 *   - Existing RPC: get_filtered_bracket_ids / w_get_filtered_bracket_ids
 *     (the pre-migration code path)
 *   - The new scan: lib/picks-filter-scan.ts → scanFilteredIds, the SAME
 *     function the route handlers call in production. We import it
 *     directly via the @/ path alias (resolved by tsconfig-paths/register).
 *
 * Asserts the two return identical id arrays in the same order.
 *
 * Usage:
 *   npm run parity:filter
 *   npm run parity:filter -- --k 20 --max-results 50000
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PICKS_BLOB_URL_MENS, PICKS_BLOB_URL_WOMENS
 *
 * Run blob:export first so the URLs are populated; this script no longer
 * supports a local-file fallback because the goal is to exercise the same
 * code path the deployed function uses.
 */

import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createClient } from "@supabase/supabase-js";
import { scanFilteredIds } from "@/lib/picks-filter-scan";

const K = parseInt(process.argv.find(a => a.startsWith("--k="))?.split("=")[1] ?? "20");
const MAX_RESULTS_FOR_DETAILED_DIFF = parseInt(
  process.argv.find(a => a.startsWith("--max-results="))?.split("=")[1] ?? "50000"
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type Gender = "mens" | "womens";

const TABLE        = (g: Gender) => g === "mens" ? "brackets" : "w_brackets";
const GAME_NODES   = (g: Gender) => g === "mens" ? "game_nodes" : "w_game_nodes";
const GAME_RESULTS = (g: Gender) => g === "mens" ? "game_results" : "w_game_results";
const RPC_NAME     = (g: Gender) => g === "mens" ? "get_filtered_bracket_ids" : "w_get_filtered_bracket_ids";

function assertBlobConfigured(g: Gender) {
  const k = g === "mens" ? "PICKS_BLOB_URL_MENS" : "PICKS_BLOB_URL_WOMENS";
  if (!process.env[k]) {
    console.error(`❌ Missing env var ${k} (run blob:export first to populate it).`);
    process.exit(1);
  }
}

// ── Predicate generation ──────────────────────────────────────────────
type Cond = { game_idx: number; team_id: number; won: boolean };

async function generatePredicates(gender: Gender, k: number): Promise<{ conditions: Cond[] }[]> {
  // Prefer real winners (always non-empty for won=true). Mix in some won=false.
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
      const r = real[Math.floor(Math.random() * real.length)];
      out.push({ conditions: [{ game_idx: r.game_idx, team_id: r.winner_id, won: true }] });
    } else if (choice < 0.8 && r64.length > 0) {
      const n = r64[Math.floor(Math.random() * r64.length)];
      const teamId = Math.random() < 0.5 ? n.team_a_id : n.team_b_id;
      out.push({ conditions: [{ game_idx: n.game_idx, team_id: teamId, won: false }] });
    } else if (real.length >= 2) {
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

// ── Main ───────────────────────────────────────────────────────────────
async function checkGender(gender: Gender, k: number) {
  console.log(`\n=== ${gender.toUpperCase()} ===`);
  assertBlobConfigured(gender);

  const { data: nodes } = await supabase.from(GAME_NODES(gender))
    .select("game_idx, round, team_a_id, team_b_id, source_a, source_b").order("game_idx");
  const nodeMap = new Map((nodes ?? []).map((n: any) => [n.game_idx, n]));

  const predicates = await generatePredicates(gender, k);
  console.log(`  Generated ${predicates.length} random predicates`);

  let allOk = true;
  for (let i = 0; i < predicates.length; i++) {
    const { conditions } = predicates[i];

    // Existing RPC — feed source_a/source_b alongside each condition (matches
    // how the production route packages them before calling the RPC).
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
    if (rpcErr) {
      console.error(`  [${i+1}] RPC failed: ${rpcErr.message}`);
      allOk = false;
      continue;
    }
    const rpcIds = ((rpcRes ?? []) as any[]).map(r => r.id);

    // Production scan path — same function the route uses.
    const t1 = Date.now();
    const scanIds = await scanFilteredIds(gender, {
      conditions,
      champion_id: null,
      min_upsets:  null,
      max_upsets:  null,
      sort_col:    "total_points",
      sort_asc:    false,
      nodeMap,
    });
    const scanTime = Date.now() - t1;

    const same =
      rpcIds.length === scanIds.length &&
      rpcIds.every((id, idx) => id === scanIds[idx]);
    const tag = same ? "OK" : "MISMATCH";
    const condStr = conditions.map(c => `g${c.game_idx}/${c.team_id}/${c.won?"W":"L"}`).join("&");
    console.log(`  [${i+1}/${predicates.length}] ${tag} ${condStr} → rpc=${rpcIds.length} (${rpcTime}ms) scan=${scanIds.length} (${scanTime}ms)`);

    if (!same) {
      allOk = false;
      const rpcSet  = new Set(rpcIds);
      const scanSet = new Set(scanIds);
      const onlyRpc  = rpcIds.filter(id => !scanSet.has(id)).slice(0, 5);
      const onlyScan = scanIds.filter(id => !rpcSet.has(id)).slice(0, 5);
      if (onlyRpc.length)  console.log(`     only-in-rpc:  ${onlyRpc.join(", ")}`);
      if (onlyScan.length) console.log(`     only-in-scan: ${onlyScan.join(", ")}`);
      if (onlyRpc.length === 0 && onlyScan.length === 0) {
        const firstDiff = rpcIds.findIndex((id, idx) => id !== scanIds[idx]);
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
