-- =====================================================
-- 040: Add BZ grenade / decoy grenade stats
-- bz_grenades_thrown    = 블루존 수류탄 사용 횟수
-- decoy_grenades_thrown = 긴급엄폐신호탄 사용 횟수
-- bz_grenade_damage     = 블루존 수류탄 데미지
-- =====================================================

ALTER TABLE match_player_telemetry_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE tournament_player_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE stage_player_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE series_player_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE tournament_team_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE stage_team_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;

ALTER TABLE series_team_stats
  ADD COLUMN IF NOT EXISTS bz_grenades_thrown    INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decoy_grenades_thrown INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bz_grenade_damage     FLOAT NOT NULL DEFAULT 0;
