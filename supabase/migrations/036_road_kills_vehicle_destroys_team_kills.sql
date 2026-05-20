-- 036_road_kills_vehicle_destroys_team_kills.sql
-- Add roadKills, vehicleDestroys, teamKills from Match API participant stats.

ALTER TABLE match_player_stats
  ADD COLUMN IF NOT EXISTS road_kills       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_destroys INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_kills       INT NOT NULL DEFAULT 0;

ALTER TABLE stage_player_stats
  ADD COLUMN IF NOT EXISTS road_kills       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_destroys INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_kills       INT NOT NULL DEFAULT 0;

ALTER TABLE series_player_stats
  ADD COLUMN IF NOT EXISTS road_kills       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_destroys INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_kills       INT NOT NULL DEFAULT 0;

ALTER TABLE tournament_player_stats
  ADD COLUMN IF NOT EXISTS road_kills       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_destroys INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_kills       INT NOT NULL DEFAULT 0;
