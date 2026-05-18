-- =====================================================
-- 019: Advancement Rules on Combined Scoreboards
-- =====================================================

ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS advance_count   INT;
ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS eliminate_count INT;
