require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ROUND_POINTS = {
  round_64: 10, round_32: 20, sweet_16: 40,
  elite_8: 80, final_four: 160, championship: 320,
};

const FETCH_BATCH = 10000;
const WRITE_CHUNK = 1000;

async function main() {
  console.log("\n=== RESCORE ALL WOMEN'S BRACKETS ===\n");

  const { data: gameResults } = await supabase.from("w_game_results").select("game_idx, winner_id");
  const { data: gameNodes } = await supabase.from("w_game_nodes").select("game_idx, round");
  const nodeMap = new Map(gameNodes.map(n => [n.game_idx, n]));

  const games = gameResults.map(gr => ({
    game_idx: gr.game_idx,
    winner_id: gr.winner_id,
    round: nodeMap.get(gr.game_idx)?.round,
    pts: ROUND_POINTS[nodeMap.get(gr.game_idx)?.round] || 0,
  })).filter(g => g.round);

  console.log(`Completed games: ${games.length}`);
  if (games.length === 0) { console.log("Nothing to score."); return; }

  const gamesDesc = [...games].sort((a, b) => b.game_idx - a.game_idx);

  const playedSet = new Set(games.map(g => g.game_idx));
  let remainingPts = 0;
  for (const n of gameNodes) {
    if (!playedSet.has(n.game_idx)) remainingPts += ROUND_POINTS[n.round] || 0;
  }
  console.log(`Remaining possible points: ${remainingPts}`);

  const { data: lo } = await supabase.from("w_brackets").select("id").order("id", { ascending: true }).limit(1).single();
  const { data: hi } = await supabase.from("w_brackets").select("id").order("id", { ascending: false }).limit(1).single();
  if (!lo || !hi) { console.log("No brackets found."); return; }
  const minId = lo.id, maxId = hi.id;
  const { count: total } = await supabase.from("w_brackets").select("id", { count: "exact", head: true });
  console.log(`Brackets: ${(total || 0).toLocaleString()}  ID range: ${minId}–${maxId}\n`);

  let processed = 0, maxScore = 0, maxCorrect = 0, writeErrors = 0;
  const t0 = Date.now();

  for (let start = minId; start <= maxId; start += FETCH_BATCH) {
    const end = Math.min(start + FETCH_BATCH - 1, maxId);

    const { data: brackets, error } = await supabase
      .from("w_brackets")
      .select("id, picks")
      .gte("id", start)
      .lte("id", end);

    if (error || !brackets || brackets.length === 0) continue;

    const groups = new Map();

    for (const b of brackets) {
      const picks = b.picks;
      let points = 0, correct = 0, streak = 0;

      for (const g of games) {
        if (picks[g.game_idx] === g.winner_id) {
          correct++;
          points += g.pts;
        }
      }

      for (const g of gamesDesc) {
        if (picks[g.game_idx] === g.winner_id)
          streak++;
        else
          break;
      }

      if (points > maxScore) maxScore = points;
      if (correct > maxCorrect) maxCorrect = correct;

      const key = `${points},${correct},${streak}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b.id);
    }

    for (const [key, ids] of groups) {
      const [points, correct, streak] = key.split(",").map(Number);
      const payload = {
        games_decided: games.length,
        correct_picks: correct,
        total_points: points,
        accuracy: parseFloat((games.length > 0 ? correct / games.length : 0).toFixed(6)),
        max_points: points + remainingPts,
        perfect_streak: streak,
        rank: null,
      };

      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        const chunk = ids.slice(i, i + WRITE_CHUNK);
        const { error: wErr } = await supabase
          .from("w_brackets")
          .update(payload)
          .in("id", chunk);
        if (wErr) writeErrors++;
      }
    }

    processed += brackets.length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const rate = Math.round(processed / ((Date.now() - t0) / 1000));
    process.stdout.write(
      `\r  ${processed.toLocaleString()} scored [${elapsed}s, ${rate}/s] best=${maxScore}pts/${maxCorrect}correct`
    );
  }

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ✓ Scoring complete (${totalTime}s, ${writeErrors} write errors)\n`);

  await supabase.from("w_scoring_log").delete().gte("id", 0);
  for (const g of games) {
    await supabase.from("w_scoring_log").insert({
      game_idx: g.game_idx,
      winner_id: g.winner_id,
      brackets_scored: total,
      scored_at: new Date().toISOString(),
    });
  }
  console.log(`  ✓ Scoring log updated (${games.length} games)`);

  console.log("Computing ranks...");
  const { error: rankErr } = await supabase.rpc("w_update_ranks");
  if (rankErr) {
    console.log(`  RPC failed: ${rankErr.message}`);
    console.log("  → Run this in Supabase SQL Editor:");
    console.log("    SET statement_timeout = '600s'; SELECT w_update_ranks();");
  } else {
    console.log("  ✓ Ranks updated");
  }

  const { data: top } = await supabase
    .from("w_brackets")
    .select("total_points, correct_picks, games_decided, accuracy, max_points, perfect_streak, rank")
    .order("total_points", { ascending: false })
    .limit(1)
    .single();
  console.log("\nTop bracket:", top);

  const { count: perfectCount } = await supabase
    .from("w_brackets")
    .select("id", { count: "exact", head: true })
    .eq("correct_picks", games.length);
  console.log(`Perfect brackets: ${perfectCount}`);

  console.log("\n✓ RESCORE COMPLETE");
}

main().catch(err => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
