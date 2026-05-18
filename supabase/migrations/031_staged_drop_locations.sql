-- =====================================================
-- 031: Staged Drop Locations
-- match_team_drop_locations : 매치별 팀 착지 중심좌표 (per-match centroid)
-- stage_drop_locations      : 스테이지별 팀 낙하지점 중간값 (median of match centroids)
-- team_drop_locations는 기존 유지 (토너먼트 토탈)
-- =====================================================

-- 매치별 팀 착지 중심좌표
CREATE TABLE IF NOT EXISTS match_team_drop_locations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id   UUID NOT NULL REFERENCES matches(id)  ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  map_name   TEXT NOT NULL,
  x          FLOAT NOT NULL,
  y          FLOAT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (match_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_match_team_drops_match ON match_team_drop_locations(match_id);
ALTER TABLE match_team_drop_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_drops_public_read"   ON match_team_drop_locations;
DROP POLICY IF EXISTS "match_drops_service_write" ON match_team_drop_locations;
CREATE POLICY "match_drops_public_read"   ON match_team_drop_locations FOR SELECT USING (true);
CREATE POLICY "match_drops_service_write" ON match_team_drop_locations FOR ALL    USING (auth.uid() IS NOT NULL);

-- 스테이지별 팀 낙하지점 중간값
CREATE TABLE IF NOT EXISTS stage_drop_locations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage_id   UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  map_name   TEXT NOT NULL,
  x          FLOAT NOT NULL,
  y          FLOAT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (stage_id, team_id, map_name)
);
CREATE INDEX IF NOT EXISTS idx_stage_drops_stage ON stage_drop_locations(stage_id);
ALTER TABLE stage_drop_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_drops_public_read"   ON stage_drop_locations;
DROP POLICY IF EXISTS "stage_drops_service_write" ON stage_drop_locations;
CREATE POLICY "stage_drops_public_read"   ON stage_drop_locations FOR SELECT USING (true);
CREATE POLICY "stage_drops_service_write" ON stage_drop_locations FOR ALL    USING (auth.uid() IS NOT NULL);
