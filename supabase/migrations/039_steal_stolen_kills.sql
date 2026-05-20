-- =====================================================
-- 039: Add steal_kills / stolen_kills, drop first_blood_kill/knock
-- steal_kills  = 내가 노킨(dBNOMaker) 적을 상대팀이 마무리한 횟수 관점에서 finisher 기준
-- stolen_kills = 내가 노킨(dBNOMaker) 적을 상대팀(finisher)이 마무리하여 킬을 뺏긴 횟수
-- =====================================================

ALTER TABLE match_player_telemetry_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE tournament_player_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE stage_player_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE series_player_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE tournament_team_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE stage_team_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;

ALTER TABLE series_team_stats
  ADD COLUMN IF NOT EXISTS steal_kills  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stolen_kills INT NOT NULL DEFAULT 0;
