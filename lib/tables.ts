// lib/tables.ts
// Maps table names for men's vs women's bracket data.
// Men's routes continue using hardcoded names (unchanged).
// Women's routes import this helper.

export type TournamentGender = "mens" | "womens";

export function tableNames(gender: TournamentGender) {
  if (gender === "womens") {
    return {
      brackets:         "w_brackets",
      game_nodes:       "w_game_nodes",
      game_results:     "w_game_results",
      tournament_teams: "w_tournament_teams",
      metadata:         "w_metadata",
      champion_counts:  "w_champion_counts",
      scoring_log:      "w_scoring_log",
    } as const;
  }
  return {
    brackets:         "brackets",
    game_nodes:       "game_nodes",
    game_results:     "game_results",
    tournament_teams: "tournament_teams",
    metadata:         "metadata",
    champion_counts:  "champion_counts",
    scoring_log:      "scoring_log",
  } as const;
}
