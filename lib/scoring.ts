// lib/scoring.ts
import { ROUND_POINTS, type Round, type BracketRow, type GameResult, type GameNode } from "./types";

/**
 * Given a new game result, compute the score delta for a bracket.
 * Returns { points_delta, correct_delta }
 */
export function scoreGame(
  picks: number[],
  result: GameResult,
): { points_delta: number; correct_delta: number } {
  const predicted = picks[result.game_idx];
  if (predicted === result.winner_id) {
    // find the round for this game — we don't have it here, handled server-side
    return { points_delta: 0, correct_delta: 1 }; // points computed by caller
  }
  return { points_delta: 0, correct_delta: 0 };
}

/**
 * Compute pick status for display in bracket view.
 * Returns "correct" | "wrong" | "pending"
 */
export function pickStatus(
  picks: number[],
  gameIdx: number,
  results: Map<number, GameResult>,
): "correct" | "wrong" | "pending" {
  const result = results.get(gameIdx);
  if (!result) return "pending";
  return picks[gameIdx] === result.winner_id ? "correct" : "wrong";
}

/**
 * Compute total score for a bracket given all completed results.
 * Used client-side for display; server-side scoring is authoritative.
 */
export function computeScore(
  picks: number[],
  results: Map<number, GameResult>,
  nodes: Map<number, GameNode>,
): { total_points: number; correct_picks: number; games_decided: number; accuracy: number } {
  let total_points  = 0;
  let correct_picks = 0;
  let games_decided = 0;

  for (const [gameIdx, result] of results) {
    games_decided++;
    if (picks[gameIdx] === result.winner_id) {
      correct_picks++;
      const node  = nodes.get(gameIdx);
      const pts   = node ? ROUND_POINTS[node.round as Round] ?? 0 : 0;
      total_points += pts;
    }
  }

  const accuracy = games_decided > 0 ? correct_picks / games_decided : 0;
  return { total_points, correct_picks, games_decided, accuracy };
}

/**
 * Format accuracy as "X/Y (Z%)"
 */
export function formatAccuracy(correct: number, decided: number): string {
  if (decided === 0) return "—";
  const pct = Math.round((correct / decided) * 100);
  return `${correct}/${decided} (${pct}%)`;
}

/**
 * Format rank with ordinal suffix: 1st, 2nd, 3rd, etc.
 */
export function formatRank(rank: number | null, total: number): string {
  if (rank === null) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = rank % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${rank.toLocaleString()}${suffix} of ${total.toLocaleString()}`;
}

/**
 * Percentile of this bracket in the full portfolio.
 */
export function computePercentile(rank: number, total: number): number {
  return Math.round(((total - rank) / total) * 100);
}
