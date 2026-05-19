-- 034_extended_telemetry_stats.sql
-- Adds advanced per-match telemetry columns and mirrors them to aggregate tables.

-- ── match_player_telemetry_stats ─────────────────────────────────────────────
ALTER TABLE match_player_telemetry_stats
  ADD COLUMN IF NOT EXISTS knock_damage_sum      FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_sum   FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_count INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_kill      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_blood_knock     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_heal_amount     FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_time        INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_time          INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assist_damage         FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_kills           INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tradeable_deaths      INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_edge_samples     INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_total_samples    INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_outside_samples  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_dist_sum         FLOAT   NOT NULL DEFAULT 0;

-- ── stage_player_stats ────────────────────────────────────────────────────────
ALTER TABLE stage_player_stats
  ADD COLUMN IF NOT EXISTS knock_damage_sum      FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_sum   FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_count INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_kills     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_knocks    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_heal_amount     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_time        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_time          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assist_damage         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_kills           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tradeable_deaths      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_edge_samples     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_total_samples    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_outside_samples  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_dist_sum         FLOAT NOT NULL DEFAULT 0;

-- ── series_player_stats ───────────────────────────────────────────────────────
ALTER TABLE series_player_stats
  ADD COLUMN IF NOT EXISTS knock_damage_sum      FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_sum   FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_count INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_kills     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_knocks    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_heal_amount     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_time        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_time          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assist_damage         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_kills           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tradeable_deaths      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_edge_samples     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_total_samples    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_outside_samples  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_dist_sum         FLOAT NOT NULL DEFAULT 0;

-- ── tournament_player_stats ───────────────────────────────────────────────────
ALTER TABLE tournament_player_stats
  ADD COLUMN IF NOT EXISTS knock_damage_sum      FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_sum   FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_dist_count INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_kills     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_blood_knocks    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_heal_amount     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_time        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_time          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assist_damage         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_kills           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tradeable_deaths      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_edge_samples     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_total_samples    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_outside_samples  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zone_dist_sum         FLOAT NOT NULL DEFAULT 0;
