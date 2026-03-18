-- =============================================================================
-- bracket-tracker schema
-- Designed for 5M+ brackets with compact picks storage
-- =============================================================================

-- -----------------------------------------------------------------------
-- tournament_teams: 68 teams in the bracket
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_teams (
    team_id     SMALLINT    PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    seed        SMALLINT    NOT NULL,
    region      VARCHAR(15) NOT NULL       -- 'East' | 'West' | 'Midwest' | 'South'
);

-- -----------------------------------------------------------------------
-- game_nodes: defines what each of the 63 game slots represents
-- game_idx 0-62 in tournament order (R64 first, Championship last)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_nodes (
    game_idx    SMALLINT    PRIMARY KEY,   -- 0-62
    round       VARCHAR(15) NOT NULL,      -- round_64 | round_32 | sweet_16 | elite_8 | final_four | championship
    region      VARCHAR(15) NOT NULL,      -- region name or 'FinalFour' | 'Championship'
    slot        SMALLINT    NOT NULL,      -- position within round
    team_a_id   SMALLINT    REFERENCES tournament_teams(team_id),
    team_b_id   SMALLINT    REFERENCES tournament_teams(team_id),
    source_a    SMALLINT,                  -- game_idx whose winner becomes team_a (NULL for R64)
    source_b    SMALLINT                   -- game_idx whose winner becomes team_b (NULL for R64)
);

-- -----------------------------------------------------------------------
-- game_results: actual tournament outcomes (filled as games happen)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_results (
    game_idx        SMALLINT    PRIMARY KEY REFERENCES game_nodes(game_idx),
    winner_id       SMALLINT    NOT NULL REFERENCES tournament_teams(team_id),
    winner_name     VARCHAR(50) NOT NULL,
    winner_seed     SMALLINT    NOT NULL,
    completed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- brackets: 5M rows, compact picks storage
-- picks is a SMALLINT[63] array — index i = game_idx i, value = winning team_id
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brackets (
    id              SERIAL          PRIMARY KEY,
    bracket_hash    CHAR(8)         UNIQUE NOT NULL,   -- short human-readable ID e.g. "A3F7K2XQ"
    picks           SMALLINT[]      NOT NULL,           -- length 63, picks[i] = predicted winner of game_idx i
    champion_id     SMALLINT        REFERENCES tournament_teams(team_id),
    champion_name   VARCHAR(50),
    champion_seed   SMALLINT,
    log_prob        FLOAT,
    upset_count     SMALLINT        DEFAULT 0,
    -- live scoring columns (updated as games finish)
    total_points    INTEGER         DEFAULT 0,
    correct_picks   SMALLINT        DEFAULT 0,
    games_decided   SMALLINT        DEFAULT 0,
    accuracy        FLOAT           DEFAULT 0,
    rank            INTEGER         -- recomputed after each game result
);

-- Indexes for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_brackets_points  ON brackets (total_points DESC);
CREATE INDEX IF NOT EXISTS idx_brackets_correct ON brackets (correct_picks DESC);
CREATE INDEX IF NOT EXISTS idx_brackets_champ   ON brackets (champion_id);
CREATE INDEX IF NOT EXISTS idx_brackets_upsets  ON brackets (upset_count);
CREATE INDEX IF NOT EXISTS idx_brackets_hash    ON brackets (bracket_hash);

-- -----------------------------------------------------------------------
-- scoring_log: audit trail of each scoring update
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scoring_log (
    id              SERIAL      PRIMARY KEY,
    game_idx        SMALLINT    NOT NULL,
    winner_id       SMALLINT    NOT NULL,
    brackets_scored INTEGER,    -- how many brackets were updated
    scored_at       TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- metadata: single-row config / status table
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata (
    key     VARCHAR(50) PRIMARY KEY,
    value   TEXT
);

INSERT INTO metadata (key, value) VALUES
    ('season',          '2026'),
    ('total_brackets',  '0'),
    ('games_completed', '0'),
    ('last_updated',    NOW()::TEXT)
ON CONFLICT (key) DO NOTHING;
