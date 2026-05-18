-- =====================================================
-- 029: Parent Team Hierarchy
-- A-1, A-2 팀을 A 조직 아래 묶어 팀 페이지에서 합산 표시
-- =====================================================

ALTER TABLE teams ADD COLUMN IF NOT EXISTS parent_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_teams_parent_team ON teams(parent_team_id);
