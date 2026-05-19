-- 035_tel_heal_boost_counts.sql
-- Add telemetry-tracked heal/boost use counts to match_player_telemetry_stats.
-- The aggregate tables (stage/series/tournament_player_stats) already have
-- heals_used and boosts_used columns from migration 033; these telemetry values
-- will override the Match API counts when aggregating.

ALTER TABLE match_player_telemetry_stats
  ADD COLUMN IF NOT EXISTS heals_used  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosts_used INT NOT NULL DEFAULT 0;
