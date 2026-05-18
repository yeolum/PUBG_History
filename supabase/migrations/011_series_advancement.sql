-- =====================================================
-- 011: Series Advancement Rules + Series-targeted Stage Prizes
-- =====================================================

ALTER TABLE series ADD COLUMN IF NOT EXISTS advance_count  INT;
ALTER TABLE series ADD COLUMN IF NOT EXISTS eliminate_count INT;

ALTER TABLE stage_prize_config ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE CASCADE;
ALTER TABLE stage_prize_config ALTER COLUMN stage_id DROP NOT NULL;

ALTER TABLE stage_prize_config DROP CONSTRAINT IF EXISTS stage_prize_config_target_xor;
ALTER TABLE stage_prize_config ADD CONSTRAINT stage_prize_config_target_xor
  CHECK ((stage_id IS NOT NULL) <> (series_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_stage_prize_config_series ON stage_prize_config(series_id);
