-- 033_extended_player_stats.sql
-- Adds API-sourced columns to match_player_stats,
-- creates match_player_telemetry_stats table,
-- and extends all pre-computed aggregation tables with new stat columns.

-- ── match_player_stats: new API-sourced columns ──────────────────────────────
ALTER TABLE match_player_stats
  ADD COLUMN IF NOT EXISTS longest_kill   FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swim_distance  FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heals_used     INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosts_used    INT   NOT NULL DEFAULT 0;

-- ── match_player_telemetry_stats: per-match telemetry-derived stats ──────────
CREATE TABLE IF NOT EXISTS match_player_telemetry_stats (
  match_id            UUID    NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pubg_account_id     TEXT    NOT NULL,
  player_id           UUID    REFERENCES players(id),
  team_id             UUID    REFERENCES teams(id),
  -- COMBAT
  deaths              INT     NOT NULL DEFAULT 0,
  damage_taken        FLOAT   NOT NULL DEFAULT 0,
  blue_zone_damage    FLOAT   NOT NULL DEFAULT 0,
  kill_distance_sum   FLOAT   NOT NULL DEFAULT 0,
  kill_distance_count INT     NOT NULL DEFAULT 0,
  -- UTILITY
  grenades_thrown     INT     NOT NULL DEFAULT 0,
  smokes_thrown       INT     NOT NULL DEFAULT 0,
  flashbangs_thrown   INT     NOT NULL DEFAULT 0,
  molotovs_thrown     INT     NOT NULL DEFAULT 0,
  grenade_damage      FLOAT   NOT NULL DEFAULT 0,
  molotov_damage      FLOAT   NOT NULL DEFAULT 0,
  grenade_hit_events  INT     NOT NULL DEFAULT 0,
  -- TEAMPLAY
  revives_given       INT     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, pubg_account_id)
);

CREATE INDEX IF NOT EXISTS idx_mpts_match ON match_player_telemetry_stats(match_id);

ALTER TABLE match_player_telemetry_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read mpts" ON match_player_telemetry_stats FOR SELECT USING (true);
CREATE POLICY "service write mpts" ON match_player_telemetry_stats FOR ALL USING (auth.role() = 'service_role');

-- ── stage_player_stats: new columns ──────────────────────────────────────────
ALTER TABLE stage_player_stats
  ADD COLUMN IF NOT EXISTS walk_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ride_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_kill         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swim_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives              INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heals_used           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosts_used          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deaths               INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_taken         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_damage     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_sum    FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_count  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenades_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smokes_thrown        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashbangs_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotovs_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotov_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_hit_events   INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives_given        INT   NOT NULL DEFAULT 0;

-- ── series_player_stats: new columns ─────────────────────────────────────────
ALTER TABLE series_player_stats
  ADD COLUMN IF NOT EXISTS walk_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ride_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_kill         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swim_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives              INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heals_used           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosts_used          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deaths               INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_taken         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_damage     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_sum    FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_count  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenades_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smokes_thrown        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashbangs_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotovs_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotov_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_hit_events   INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives_given        INT   NOT NULL DEFAULT 0;

-- ── tournament_player_stats: new columns ─────────────────────────────────────
ALTER TABLE tournament_player_stats
  ADD COLUMN IF NOT EXISTS walk_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ride_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_kill         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swim_distance        FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives              INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heals_used           INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosts_used          INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deaths               INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_taken         FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_zone_damage     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_sum    FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kill_distance_count  INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenades_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smokes_thrown        INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashbangs_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotovs_thrown      INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS molotov_damage       FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grenade_hit_events   INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revives_given        INT   NOT NULL DEFAULT 0;
