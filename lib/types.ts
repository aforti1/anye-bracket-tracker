// lib/types.ts

export type Round =
  | "round_64"
  | "round_32"
  | "sweet_16"
  | "elite_8"
  | "final_four"
  | "championship";

export const ROUND_LABELS: Record<Round, string> = {
  round_64:     "Round of 64",
  round_32:     "Round of 32",
  sweet_16:     "Sweet 16",
  elite_8:      "Elite 8",
  final_four:   "Final Four",
  championship: "Championship",
};

export const ROUND_POINTS: Record<Round, number> = {
  round_64:     10,
  round_32:     20,
  sweet_16:     40,
  elite_8:      80,
  final_four:   160,
  championship: 320,
};

export const MAX_POSSIBLE_SCORE = 1920; // sum of all round points * games

export type Region = "East" | "West" | "Midwest" | "South";

export interface TournamentTeam {
  team_id:  number;
  name:     string;
  seed:     number;
  region:   Region;
}

export interface GameNode {
  game_idx:  number;
  round:     Round;
  region:    string;
  slot:      number;
  team_a_id: number | null;
  team_b_id: number | null;
  source_a:  number | null;
  source_b:  number | null;
}

export interface GameResult {
  game_idx:     number;
  winner_id:    number;
  winner_name:  string;
  winner_seed:  number;
  completed_at: string;
}

// One row from the brackets table
export interface BracketRow {
  id:             number;
  bracket_hash:   string;
  picks:          number[];   // length 63 — picks[i] = predicted winner team_id for game_idx i
  champion_id:    number | null;
  champion_name:  string | null;
  champion_seed:  number | null;
  log_prob:       number | null;
  upset_count:    number;
  total_points:   number;
  correct_picks:  number;
  games_decided:  number;
  accuracy:       number;
  rank:           number | null;
  max_points:     number | null;      // current pts + potential remaining pts
  perfect_streak: number | null;      // consecutive correct from most recent game
}

// Enriched bracket for display (picks resolved to team info)
export interface BracketDetail extends BracketRow {
  pick_details: PickDetail[];
}

export interface PickDetail {
  game_idx:    number;
  round:       Round;
  region:      string;
  team_a:      TournamentTeam | null;
  team_b:      TournamentTeam | null;
  predicted_winner: TournamentTeam | null;
  actual_winner:    TournamentTeam | null;  // null if game not played yet
  correct:     boolean | null;              // null if pending
  points:      number;                      // points earned (0 if wrong/pending)
}

// Leaderboard API response
export interface LeaderboardResponse {
  brackets:       BracketRow[];
  total:          number;
  page:           number;
  per_page:       number;
  total_pages:    number;
  games_complete: number;
  tournament_live: boolean;
}

// Summary stats for the header
export interface TournamentSummary {
  total_brackets:    number;
  games_completed:   number;
  games_total:       number;
  top_score:         number;
  top_bracket_hash:  string | null;
  unique_champions:  number;
  last_updated:      string | null;
  perfect_remaining: number | null;
}
