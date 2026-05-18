-- =====================================================
-- 015: WWCD Rewards + Prize Config → Series Targeting
-- =====================================================

ALTER TABLE tournament_wwcd_rewards    ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tournament_wwcd_rewards_series ON tournament_wwcd_rewards(series_id);

ALTER TABLE tournament_prize_config    ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_prize_config_series ON tournament_prize_config(series_id);
