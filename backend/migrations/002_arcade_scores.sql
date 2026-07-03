-- Arcade high scores: one best-per-user row per cabinet game.
CREATE TABLE IF NOT EXISTS arcade_scores (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game text NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game)
);

-- Leaderboard read path: top-N by score within a game.
CREATE INDEX IF NOT EXISTS arcade_scores_game_score_idx
  ON arcade_scores (game, score DESC);
