-- =====================================================
-- 023: Stage Additional Points
-- 특정 스테이지에서 팀에 추가 포인트 부여
-- =====================================================

CREATE TABLE IF NOT EXISTS stage_additional_points (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id   UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  team_name  TEXT NOT NULL,
  team_id    UUID REFERENCES teams(id),
  points     INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stage_additional_points_stage ON stage_additional_points(stage_id);
ALTER TABLE stage_additional_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_additional_points_public_read" ON stage_additional_points;
DROP POLICY IF EXISTS "stage_additional_points_auth_write"  ON stage_additional_points;
CREATE POLICY "stage_additional_points_public_read" ON stage_additional_points FOR SELECT USING (true);
CREATE POLICY "stage_additional_points_auth_write"  ON stage_additional_points FOR ALL    USING (auth.uid() IS NOT NULL);
