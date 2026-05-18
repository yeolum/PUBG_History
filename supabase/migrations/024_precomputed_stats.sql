-- =====================================================
-- 024: Pre-computed Tournament Team / Player Stats
-- compute-tournament-stats 실행 시 자동 집계
-- =====================================================

CREATE TABLE IF NOT EXISTS tournament_team_stats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name     TEXT NOT NULL,
  logo_url      TEXT,
  games         INT     NOT NULL DEFAULT 0,
  wwcd          INT     NOT NULL DEFAULT 0,
  total_kills   INT     NOT NULL DEFAULT 0,
  total_damage  NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournament_team_stats_tournament ON tournament_team_stats(tournament_id);
ALTER TABLE tournament_team_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tournament_team_stats_public_read"   ON tournament_team_stats;
DROP POLICY IF EXISTS "tournament_team_stats_service_write" ON tournament_team_stats;
CREATE POLICY "tournament_team_stats_public_read"   ON tournament_team_stats FOR SELECT USING (true);
CREATE POLICY "tournament_team_stats_service_write" ON tournament_team_stats FOR ALL    USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS tournament_player_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id      UUID REFERENCES players(id) ON DELETE SET NULL,
  nickname       TEXT NOT NULL,
  team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name      TEXT NOT NULL DEFAULT '',
  logo_url       TEXT,
  games          INT     NOT NULL DEFAULT 0,
  kills          INT     NOT NULL DEFAULT 0,
  assists        INT     NOT NULL DEFAULT 0,
  knocks         INT     NOT NULL DEFAULT 0,
  headshot_kills INT     NOT NULL DEFAULT 0,
  damage         NUMERIC NOT NULL DEFAULT 0,
  survival_time  NUMERIC NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournament_player_stats_tournament ON tournament_player_stats(tournament_id);
ALTER TABLE tournament_player_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tournament_player_stats_public_read"   ON tournament_player_stats;
DROP POLICY IF EXISTS "tournament_player_stats_service_write" ON tournament_player_stats;
CREATE POLICY "tournament_player_stats_public_read"   ON tournament_player_stats FOR SELECT USING (true);
CREATE POLICY "tournament_player_stats_service_write" ON tournament_player_stats FOR ALL    USING (auth.role() = 'service_role');
