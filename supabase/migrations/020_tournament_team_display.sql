-- =====================================================
-- 020: Per-tournament Team Display Name
-- 대회 당시 팀명 고정 (이후 리브랜딩과 무관하게 유지)
-- =====================================================

ALTER TABLE tournament_teams ADD COLUMN IF NOT EXISTS display_name TEXT;
