-- =====================================================
-- 017: Combined Scoreboards
-- 여러 스테이지를 묶어 합산 순위를 보여주는 뷰 단위
-- =====================================================

CREATE TABLE IF NOT EXISTS combined_scoreboards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  order_num     INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_combined_scoreboards_tournament ON combined_scoreboards(tournament_id);

CREATE TABLE IF NOT EXISTS combined_scoreboard_stages (
  combined_scoreboard_id UUID NOT NULL REFERENCES combined_scoreboards(id) ON DELETE CASCADE,
  stage_id               UUID NOT NULL REFERENCES stages(id)               ON DELETE CASCADE,
  PRIMARY KEY (combined_scoreboard_id, stage_id)
);
CREATE INDEX IF NOT EXISTS idx_combined_scoreboard_stages_stage ON combined_scoreboard_stages(stage_id);

ALTER TABLE combined_scoreboards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE combined_scoreboard_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "combined_scoreboards_public_read" ON combined_scoreboards;
DROP POLICY IF EXISTS "combined_scoreboards_auth_write"  ON combined_scoreboards;
CREATE POLICY "combined_scoreboards_public_read" ON combined_scoreboards FOR SELECT USING (true);
CREATE POLICY "combined_scoreboards_auth_write"  ON combined_scoreboards FOR ALL    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "combined_scoreboard_stages_public_read" ON combined_scoreboard_stages;
DROP POLICY IF EXISTS "combined_scoreboard_stages_auth_write"  ON combined_scoreboard_stages;
CREATE POLICY "combined_scoreboard_stages_public_read" ON combined_scoreboard_stages FOR SELECT USING (true);
CREATE POLICY "combined_scoreboard_stages_auth_write"  ON combined_scoreboard_stages FOR ALL    USING (auth.uid() IS NOT NULL);

-- Prize & Points 에서 combined scoreboard 순위를 타깃으로 지정 가능
ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS combined_scoreboard_id UUID REFERENCES combined_scoreboards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_prize_config_combined ON tournament_prize_config(combined_scoreboard_id);
