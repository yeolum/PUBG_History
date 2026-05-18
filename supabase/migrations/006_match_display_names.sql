-- =====================================================
-- 006: Display Name Columns for Match Results
-- 경기 당시 팀/선수 이름을 별도 저장 (이후 리브랜딩과 무관하게 유지)
-- =====================================================

ALTER TABLE match_team_results   ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE match_player_stats   ADD COLUMN IF NOT EXISTS display_name TEXT;
