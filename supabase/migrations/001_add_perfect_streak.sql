-- Add perfect_streak column for archival mode.
-- Once the tournament is finalized, perfect_streak is constant per bracket
-- (no new games can shift it), so we precompute and store it instead of
-- recomputing from picks on every leaderboard render.
--
-- Backfill: scripts/backfill-perfect-streak.ts (reads picks from the source
-- Parquet files in the sibling ML repo, NOT from Supabase).
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE brackets   ADD COLUMN IF NOT EXISTS perfect_streak SMALLINT;
ALTER TABLE w_brackets ADD COLUMN IF NOT EXISTS perfect_streak SMALLINT;
