-- =====================================================
-- 016: Tournament Tag (짧은 식별자 배지)
-- =====================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tag TEXT;
