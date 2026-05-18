-- =====================================================
-- 003: Stage Mapping for Prize Config Rows
-- =====================================================

ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS stage_id   UUID REFERENCES stages(id) ON DELETE SET NULL;
ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS stage_rank INT;
