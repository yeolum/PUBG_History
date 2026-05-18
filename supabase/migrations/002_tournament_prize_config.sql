-- =====================================================
-- 002: Tournament Prize & Points Configuration
-- =====================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_prize        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_pgs_points   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_pgc_points   BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS tournament_prize_config (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  rank          INT  NOT NULL,
  prize         TEXT,
  pgs_points    NUMERIC,
  pgc_points    NUMERIC,
  PRIMARY KEY (tournament_id, rank)
);
