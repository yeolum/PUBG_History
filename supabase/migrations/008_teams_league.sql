-- =====================================================
-- 008: Teams League Field
-- =====================================================

ALTER TABLE teams ADD COLUMN IF NOT EXISTS league TEXT;
