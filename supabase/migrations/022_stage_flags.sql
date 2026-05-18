-- =====================================================
-- 022: Stage include_in_total Flag
-- OFF 시 해당 스테이지 데이터를 Final Standings / 전체 통계에서 제외
-- =====================================================

ALTER TABLE stages ADD COLUMN IF NOT EXISTS include_in_total BOOLEAN NOT NULL DEFAULT TRUE;
