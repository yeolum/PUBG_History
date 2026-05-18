-- =====================================================
-- 009: Drop Locations
-- players.nationality_code
-- team_drop_locations  : 대회별 팀 낙하 지점 (정규화 좌표)
-- match_player_landings: 매치별 선수 낙하 원본 데이터
-- =====================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS nationality_code TEXT;

CREATE TABLE IF NOT EXISTS team_drop_locations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
  map_name      TEXT NOT NULL,
  x             FLOAT NOT NULL DEFAULT 0.5,
  y             FLOAT NOT NULL DEFAULT 0.5,
  label         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (tournament_id, team_id, map_name)
);
CREATE INDEX IF NOT EXISTS idx_drop_locs_tournament ON team_drop_locations(tournament_id);
ALTER TABLE team_drop_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drop_locs_public_read"  ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_insert"  ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_update"  ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_delete"  ON team_drop_locations;
CREATE POLICY "drop_locs_public_read"  ON team_drop_locations FOR SELECT USING (true);
CREATE POLICY "drop_locs_auth_insert"  ON team_drop_locations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "drop_locs_auth_update"  ON team_drop_locations FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "drop_locs_auth_delete"  ON team_drop_locations FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS match_player_landings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id         UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pubg_player_name TEXT NOT NULL,
  team_id          UUID REFERENCES teams(id),
  pubg_team_name   TEXT,
  x_norm           FLOAT NOT NULL,
  y_norm           FLOAT NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_landings_match ON match_player_landings(match_id);
ALTER TABLE match_player_landings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "landings_public_read" ON match_player_landings;
DROP POLICY IF EXISTS "landings_auth_write"  ON match_player_landings;
CREATE POLICY "landings_public_read" ON match_player_landings FOR SELECT USING (true);
CREATE POLICY "landings_auth_write"  ON match_player_landings FOR ALL    USING (auth.uid() IS NOT NULL);
