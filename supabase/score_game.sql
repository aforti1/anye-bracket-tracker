-- supabase/score_game.sql
-- Run this in Supabase SQL Editor AFTER schema.sql
-- Creates a stored procedure that scores all 5M brackets in one shot when a game result comes in.

CREATE OR REPLACE FUNCTION score_game(
  p_game_idx  SMALLINT,
  p_winner_id SMALLINT,
  p_points    INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Single-pass update: increment games_decided for ALL brackets,
  -- add points + correct_picks only where the pick matched the winner.
  -- NOTE: Postgres arrays are 1-indexed; our game_idx is 0-indexed → picks[p_game_idx + 1]
  UPDATE brackets
  SET
    games_decided = games_decided + 1,
    correct_picks = correct_picks + CASE WHEN picks[p_game_idx + 1] = p_winner_id THEN 1 ELSE 0 END,
    total_points  = total_points  + CASE WHEN picks[p_game_idx + 1] = p_winner_id THEN p_points ELSE 0 END,
    accuracy      = CASE
                      WHEN (games_decided + 1) > 0
                      THEN (correct_picks + CASE WHEN picks[p_game_idx + 1] = p_winner_id THEN 1 ELSE 0 END)::FLOAT
                           / (games_decided + 1)
                      ELSE 0
                    END;

  -- Log the scoring event
  INSERT INTO scoring_log (game_idx, winner_id, brackets_scored, scored_at)
  VALUES (p_game_idx, p_winner_id, (SELECT COUNT(*) FROM brackets), NOW());
END;
$$;
