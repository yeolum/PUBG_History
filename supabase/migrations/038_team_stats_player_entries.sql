-- =====================================================
-- 038: Add player_entries to team stats tables
-- avgSurvival = survival_time / player_entries (per-player average)
-- =====================================================

ALTER TABLE tournament_team_stats
  ADD COLUMN IF NOT EXISTS player_entries INT NOT NULL DEFAULT 0;

ALTER TABLE stage_team_stats
  ADD COLUMN IF NOT EXISTS player_entries INT NOT NULL DEFAULT 0;

ALTER TABLE series_team_stats
  ADD COLUMN IF NOT EXISTS player_entries INT NOT NULL DEFAULT 0;
