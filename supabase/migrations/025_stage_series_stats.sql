-- =====================================================
-- 025: Per-stage / Per-series Pre-computed Player Stats
-- =====================================================

CREATE TABLE IF NOT EXISTS stage_player_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id       UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_stage_player_stats_stage ON stage_player_stats(stage_id);
ALTER TABLE stage_player_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_player_stats_public_read"   ON stage_player_stats;
DROP POLICY IF EXISTS "stage_player_stats_service_write" ON stage_player_stats;
CREATE POLICY "stage_player_stats_public_read"   ON stage_player_stats FOR SELECT USING (true);
CREATE POLICY "stage_player_stats_service_write" ON stage_player_stats FOR ALL    USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS series_player_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id      UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_series_player_stats_series ON series_player_stats(series_id);
ALTER TABLE series_player_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "series_player_stats_public_read"   ON series_player_stats;
DROP POLICY IF EXISTS "series_player_stats_service_write" ON series_player_stats;
CREATE POLICY "series_player_stats_public_read"   ON series_player_stats FOR SELECT USING (true);
CREATE POLICY "series_player_stats_service_write" ON series_player_stats FOR ALL    USING (auth.role() = 'service_role');
