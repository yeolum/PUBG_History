-- =====================================================
-- 014: Tournament Team Disqualification Flag
-- =====================================================

ALTER TABLE tournament_teams ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT FALSE;
