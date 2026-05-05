-- =====================================================
-- Migration: storage bucket for images (logos, banners, profile pics)
-- =====================================================

-- Create public 'images' bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Public read (anyone can view uploaded images)
CREATE POLICY IF NOT EXISTS "images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'images');

-- Authenticated upload
CREATE POLICY IF NOT EXISTS "images_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'images');

-- Authenticated update (upsert)
CREATE POLICY IF NOT EXISTS "images_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'images');

-- Authenticated delete
CREATE POLICY IF NOT EXISTS "images_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'images');

-- =====================================================
-- Migration: tournament prize & points configuration
-- =====================================================
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_prize BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_pgs_points BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_pgc_points BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS tournament_prize_config (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  rank INT NOT NULL,
  prize TEXT,
  pgs_points NUMERIC,
  pgc_points NUMERIC,
  PRIMARY KEY (tournament_id, rank)
);

-- =====================================================
-- Migration: stage mapping for prize config rows
-- =====================================================
ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES stages(id) ON DELETE SET NULL;
ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS stage_rank INT;

-- =====================================================
-- Migration: per-alias images (historical logos / profile pics)
-- =====================================================
ALTER TABLE team_aliases ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE player_aliases ADD COLUMN IF NOT EXISTS profile_pic TEXT;

-- RLS UPDATE policies for alias tables (required for admin logo save)
-- If RLS is enabled on these tables, run the following:
DROP POLICY IF EXISTS "team_aliases_update_auth" ON team_aliases;
CREATE POLICY "team_aliases_update_auth"
  ON team_aliases FOR UPDATE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "player_aliases_update_auth" ON player_aliases;
CREATE POLICY "player_aliases_update_auth"
  ON player_aliases FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- =====================================================
-- Migration: series (optional grouping layer: Tournament → Series → Stage → Match)
-- Supabase SQL Editor에서 실행하세요
-- =====================================================
CREATE TABLE IF NOT EXISTS series (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_num INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_series_tournament_v2 ON series(tournament_id);
ALTER TABLE stages ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE SET NULL;

CREATE POLICY "series_public_read"
  ON series FOR SELECT
  USING (true);

CREATE POLICY "series_auth_insert"
  ON series FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "series_auth_update"
  ON series FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "series_auth_delete"
  ON series FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- =====================================================
-- Migration: display_name for historical team/player name in match results
-- Supabase SQL Editor에서 실행하세요
-- =====================================================
ALTER TABLE match_team_results ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS display_name TEXT;

-- =====================================================
-- Migration: series 제거, stages를 tournament에 직접 연결
-- Supabase SQL Editor에서 실행하세요
-- =====================================================

-- 1. stages 테이블에 tournament_id 컬럼 추가
ALTER TABLE stages ADD COLUMN tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE;

-- 2. 기존 series → tournament 관계로 tournament_id 채우기
UPDATE stages s
SET tournament_id = (
  SELECT sr.tournament_id FROM series sr WHERE sr.id = s.series_id
);

-- 3. tournament_id NOT NULL 설정
ALTER TABLE stages ALTER COLUMN tournament_id SET NOT NULL;

-- 4. series_id 외래키 및 컬럼 제거
ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_series_id_fkey;
ALTER TABLE stages DROP COLUMN IF EXISTS series_id;

-- 5. series 테이블 삭제
DROP TABLE IF EXISTS series CASCADE;

-- 6. 인덱스 업데이트
DROP INDEX IF EXISTS idx_series_tournament;
DROP INDEX IF EXISTS idx_series_tournament_v2;
DROP INDEX IF EXISTS idx_stages_series;
CREATE INDEX IF NOT EXISTS idx_stages_tournament ON stages(tournament_id);

-- 7. 기존 view 삭제 후 새 view 생성
DROP VIEW IF EXISTS stage_team_standings;

CREATE VIEW stage_team_standings AS
SELECT
  s.id AS stage_id,
  s.name AS stage_name,
  mtr.team_id,
  COALESCE(t.name, mtr.pubg_team_name) AS team_name,
  COALESCE(t.short_name, mtr.pubg_team_name) AS team_short_name,
  COUNT(DISTINCT m.id) AS matches_played,
  SUM(mtr.total_kills) AS total_kills,
  ROUND(SUM(mtr.total_damage)::numeric, 1) AS total_damage,
  ROUND(AVG(mtr.placement)::numeric, 2) AS avg_placement,
  SUM(
    CASE mtr.placement
      WHEN 1 THEN 10
      WHEN 2 THEN 6
      WHEN 3 THEN 5
      WHEN 4 THEN 4
      WHEN 5 THEN 3
      WHEN 6 THEN 2
      WHEN 7 THEN 1
      WHEN 8 THEN 1
      ELSE 0
    END
  ) AS placement_points,
  SUM(
    CASE mtr.placement
      WHEN 1 THEN 10
      WHEN 2 THEN 6
      WHEN 3 THEN 5
      WHEN 4 THEN 4
      WHEN 5 THEN 3
      WHEN 6 THEN 2
      WHEN 7 THEN 1
      WHEN 8 THEN 1
      ELSE 0
    END + mtr.total_kills
  ) AS total_points
FROM stages s
JOIN matches m ON m.stage_id = s.id AND m.status = 'imported'
JOIN match_team_results mtr ON mtr.match_id = m.id
LEFT JOIN teams t ON t.id = mtr.team_id
WHERE mtr.team_id IS NOT NULL OR mtr.pubg_team_name IS NOT NULL
GROUP BY s.id, s.name, mtr.team_id, t.name, t.short_name, mtr.pubg_team_name
ORDER BY total_points DESC;

-- =====================================================
-- Migration: league field for teams
-- =====================================================
ALTER TABLE teams ADD COLUMN IF NOT EXISTS league TEXT;

-- =====================================================
-- Migration: nationality_code for players + team drop locations
-- =====================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS nationality_code TEXT;

CREATE TABLE IF NOT EXISTS team_drop_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  map_name TEXT NOT NULL,
  x FLOAT NOT NULL DEFAULT 0.5,
  y FLOAT NOT NULL DEFAULT 0.5,
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tournament_id, team_id, map_name)
);
CREATE INDEX IF NOT EXISTS idx_drop_locs_tournament ON team_drop_locations(tournament_id);
ALTER TABLE team_drop_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drop_locs_public_read" ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_insert" ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_update" ON team_drop_locations;
DROP POLICY IF EXISTS "drop_locs_auth_delete" ON team_drop_locations;
CREATE POLICY "drop_locs_public_read" ON team_drop_locations FOR SELECT USING (true);
CREATE POLICY "drop_locs_auth_insert" ON team_drop_locations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "drop_locs_auth_update" ON team_drop_locations FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "drop_locs_auth_delete" ON team_drop_locations FOR DELETE USING (auth.uid() IS NOT NULL);

-- =====================================================
-- Migration: match_player_landings for auto drop-location computation
-- =====================================================

CREATE TABLE IF NOT EXISTS match_player_landings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pubg_player_name TEXT NOT NULL,
  team_id UUID REFERENCES teams(id),
  pubg_team_name TEXT,
  x_norm FLOAT NOT NULL,
  y_norm FLOAT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_landings_match ON match_player_landings(match_id);
ALTER TABLE match_player_landings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "landings_public_read" ON match_player_landings;
DROP POLICY IF EXISTS "landings_auth_write" ON match_player_landings;
CREATE POLICY "landings_public_read" ON match_player_landings FOR SELECT USING (true);
CREATE POLICY "landings_auth_write" ON match_player_landings FOR ALL USING (auth.uid() IS NOT NULL);

-- =====================================================
-- Migration: tournament-level currency + numeric prize columns
-- One currency per tournament; all prize values stored as NUMERIC
-- =====================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS currency TEXT;

-- Detect currency from existing prize_pool prefix
UPDATE tournaments
SET currency = CASE
  WHEN prize_pool LIKE 'A$%'  THEN 'AUD'
  WHEN prize_pool LIKE 'S$%'  THEN 'SGD'
  WHEN prize_pool LIKE 'CN¥%' THEN 'CNY'
  WHEN prize_pool LIKE '$%'   THEN 'USD'
  WHEN prize_pool LIKE '€%'   THEN 'EUR'
  WHEN prize_pool LIKE '₩%'   THEN 'KRW'
  WHEN prize_pool LIKE '£%'   THEN 'GBP'
  WHEN prize_pool LIKE '¥%'   THEN 'JPY'
  ELSE NULL
END
WHERE currency IS NULL AND prize_pool IS NOT NULL;

-- For tournaments with no prize_pool, derive from any prize_config row
UPDATE tournaments t
SET currency = sub.cur
FROM (
  SELECT DISTINCT ON (pc.tournament_id) pc.tournament_id,
    CASE
      WHEN pc.prize LIKE 'A$%'  THEN 'AUD'
      WHEN pc.prize LIKE 'S$%'  THEN 'SGD'
      WHEN pc.prize LIKE 'CN¥%' THEN 'CNY'
      WHEN pc.prize LIKE '$%'   THEN 'USD'
      WHEN pc.prize LIKE '€%'   THEN 'EUR'
      WHEN pc.prize LIKE '₩%'   THEN 'KRW'
      WHEN pc.prize LIKE '£%'   THEN 'GBP'
      WHEN pc.prize LIKE '¥%'   THEN 'JPY'
      ELSE NULL
    END AS cur
  FROM tournament_prize_config pc
  WHERE pc.prize IS NOT NULL
) sub
WHERE t.id = sub.tournament_id AND t.currency IS NULL AND sub.cur IS NOT NULL;

-- Default any remaining NULLs and lock the column
UPDATE tournaments SET currency = 'USD' WHERE currency IS NULL;
ALTER TABLE tournaments ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE tournaments ALTER COLUMN currency SET NOT NULL;

-- Strip prefixes and convert prize columns to NUMERIC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tournaments' AND column_name = 'prize_pool' AND data_type = 'text') THEN
    ALTER TABLE tournaments
      ALTER COLUMN prize_pool TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize_pool, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tournament_prize_config' AND column_name = 'prize' AND data_type = 'text') THEN
    ALTER TABLE tournament_prize_config
      ALTER COLUMN prize TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stage_prize_config')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'stage_prize_config' AND column_name = 'prize' AND data_type = 'text') THEN
    ALTER TABLE stage_prize_config
      ALTER COLUMN prize TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_wwcd_rewards')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tournament_wwcd_rewards' AND column_name = 'prize' AND data_type = 'text') THEN
    ALTER TABLE tournament_wwcd_rewards
      ALTER COLUMN prize TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_special_awards')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tournament_special_awards' AND column_name = 'prize' AND data_type = 'text') THEN
    ALTER TABLE tournament_special_awards
      ALTER COLUMN prize TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;
END $$;

-- =====================================================
-- Migration: series-level advancement rules + series-targeted stage prizes
-- =====================================================

ALTER TABLE series ADD COLUMN IF NOT EXISTS advance_count INT;
ALTER TABLE series ADD COLUMN IF NOT EXISTS eliminate_count INT;

ALTER TABLE stage_prize_config ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE CASCADE;
ALTER TABLE stage_prize_config ALTER COLUMN stage_id DROP NOT NULL;

-- Exactly one target (stage XOR series) must be set per row
ALTER TABLE stage_prize_config DROP CONSTRAINT IF EXISTS stage_prize_config_target_xor;
ALTER TABLE stage_prize_config ADD CONSTRAINT stage_prize_config_target_xor
  CHECK ((stage_id IS NOT NULL) <> (series_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_stage_prize_config_series ON stage_prize_config(series_id);

-- =====================================================
-- Migration: per-tournament participant roster
-- Restricts auto-linking during match import to teams/players that are
-- actually playing this tournament — prevents wrong links when team tags
-- or player nicknames collide across the global pool.
-- =====================================================

CREATE TABLE IF NOT EXISTS tournament_teams (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_team ON tournament_teams(team_id);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id);

ALTER TABLE tournament_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tournament_teams_public_read" ON tournament_teams;
DROP POLICY IF EXISTS "tournament_teams_auth_write" ON tournament_teams;
CREATE POLICY "tournament_teams_public_read" ON tournament_teams FOR SELECT USING (true);
CREATE POLICY "tournament_teams_auth_write"  ON tournament_teams FOR ALL    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tournament_players_public_read" ON tournament_players;
DROP POLICY IF EXISTS "tournament_players_auth_write" ON tournament_players;
CREATE POLICY "tournament_players_public_read" ON tournament_players FOR SELECT USING (true);
CREATE POLICY "tournament_players_auth_write"  ON tournament_players FOR ALL    USING (auth.uid() IS NOT NULL);

-- =====================================================
-- Migration: tournament-scoped team for each registered player
-- A player's global players.team_id (their current team) is unrelated to the
-- team they're playing for in any specific tournament — store the tournament
-- assignment explicitly so display / rosters don't cross-pollinate teams.
-- =====================================================

ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Backfill: existing rows default to the player's current team_id
UPDATE tournament_players tp
SET team_id = (SELECT p.team_id FROM players p WHERE p.id = tp.player_id)
WHERE tp.team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_players_team_id ON tournament_players(team_id);

-- =====================================================
-- Migration: keep players.team_id (current global team) synced with the
-- team they played for in their most recent imported match. Called from
-- the match-import path so a transfer is reflected automatically.
-- =====================================================

CREATE OR REPLACE FUNCTION sync_player_current_teams(player_ids UUID[])
RETURNS void AS $$
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (mps.player_id)
      mps.player_id,
      mps.team_id
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    WHERE mps.player_id = ANY(player_ids)
      AND mps.team_id IS NOT NULL
      AND m.status = 'imported'
    ORDER BY mps.player_id,
             m.match_date DESC NULLS LAST,
             m.order_num DESC
  )
  UPDATE players p
  SET team_id = latest.team_id,
      updated_at = NOW()
  FROM latest
  WHERE p.id = latest.player_id
    AND p.team_id IS DISTINCT FROM latest.team_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- One-time backfill for existing data — idempotent (no-op when already in sync)
SELECT sync_player_current_teams(ARRAY(SELECT id FROM players));

-- =====================================================
-- Migration: per-tournament team disqualification flag
-- DQ teams are removed from the active Final Standings ranking and listed
-- at the bottom of the table marked DQ, with their stat columns hidden.
-- =====================================================

ALTER TABLE tournament_teams ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT FALSE;

-- =====================================================
-- Migration: WWCD rewards can target a series (in addition to a stage / all)
-- A reward applies to a chicken dinner in: a specific stage (stage_id set),
-- any stage of a series (series_id set), or every imported match in the
-- tournament (both null).
-- =====================================================

ALTER TABLE tournament_wwcd_rewards ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tournament_wwcd_rewards_series ON tournament_wwcd_rewards(series_id);

-- =====================================================
-- Migration: Prize & Points rows can map their rank from a series's
-- cumulative standings (in addition to a stage). Each row points at
-- either a stage_id OR a series_id (or neither = unmapped).
-- =====================================================

ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_prize_config_series ON tournament_prize_config(series_id);

-- =====================================================
-- Migration: tournaments get a separate `tag` (very short identifier) on
-- top of the existing `short_name`. Profiles render short_name; the
-- tournament detail header also surfaces tag as a monospace badge.
-- =====================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tag TEXT;

-- =====================================================
-- Migration: combined scoreboards — view-only aggregations of selected
-- stages. Cumulative standings of the chosen stages can be:
--   - Picked as a Prize & Points target (combined_scoreboard_id)
--   - Browsed as its own scoreboard tab on the public page
-- They never add to team_stats / player_stats / final standings
-- aggregation themselves; only the underlying matches do.
-- =====================================================

CREATE TABLE IF NOT EXISTS combined_scoreboards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  order_num     INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_combined_scoreboards_tournament ON combined_scoreboards(tournament_id);

CREATE TABLE IF NOT EXISTS combined_scoreboard_stages (
  combined_scoreboard_id UUID NOT NULL REFERENCES combined_scoreboards(id) ON DELETE CASCADE,
  stage_id               UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  PRIMARY KEY (combined_scoreboard_id, stage_id)
);
CREATE INDEX IF NOT EXISTS idx_combined_scoreboard_stages_stage ON combined_scoreboard_stages(stage_id);

ALTER TABLE combined_scoreboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE combined_scoreboard_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "combined_scoreboards_public_read" ON combined_scoreboards;
DROP POLICY IF EXISTS "combined_scoreboards_auth_write"  ON combined_scoreboards;
CREATE POLICY "combined_scoreboards_public_read" ON combined_scoreboards FOR SELECT USING (true);
CREATE POLICY "combined_scoreboards_auth_write"  ON combined_scoreboards FOR ALL    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "combined_scoreboard_stages_public_read" ON combined_scoreboard_stages;
DROP POLICY IF EXISTS "combined_scoreboard_stages_auth_write"  ON combined_scoreboard_stages;
CREATE POLICY "combined_scoreboard_stages_public_read" ON combined_scoreboard_stages FOR SELECT USING (true);
CREATE POLICY "combined_scoreboard_stages_auth_write"  ON combined_scoreboard_stages FOR ALL    USING (auth.uid() IS NOT NULL);

-- Prize & Points Target can now point to a combined scoreboard's rank.
ALTER TABLE tournament_prize_config ADD COLUMN IF NOT EXISTS combined_scoreboard_id UUID REFERENCES combined_scoreboards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_prize_config_combined ON tournament_prize_config(combined_scoreboard_id);

-- =====================================================
-- Migration: unified `tab_order` for top-level scoreboard sections.
-- Series / standalone stage / combined scoreboard each carry their own
-- tab_order and the public page sorts by it directly. Lets admin drag
-- a single combined list to reorder the public scoreboard tabs.
-- =====================================================

ALTER TABLE series ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;
ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;

-- Backfill: keep the current effective ordering (min stage.order_num for
-- series / combined, stage.order_num for standalone stages) so the existing
-- public layout doesn't shuffle when the migration runs.
UPDATE series sr
SET tab_order = COALESCE((
  SELECT MIN(s.order_num) FROM stages s WHERE s.series_id = sr.id
), 999999)
WHERE tab_order = 0;

UPDATE stages SET tab_order = order_num WHERE series_id IS NULL AND tab_order = 0;

UPDATE combined_scoreboards cb
SET tab_order = COALESCE((
  SELECT MIN(s.order_num) FROM stages s
  JOIN combined_scoreboard_stages css ON css.stage_id = s.id
  WHERE css.combined_scoreboard_id = cb.id
), 999999)
WHERE tab_order = 0;

-- =====================================================
-- Migration: Advancement Rules on Combined Scoreboards
-- Mirrors series.advance_count / eliminate_count so the public combined
-- standings can render the same green ADVANCE / red ELIMINATED dividers.
-- =====================================================

ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS advance_count   INT;
ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS eliminate_count INT;

-- =====================================================
-- Migration: Per-tournament team display name
-- The team's global teams.name may have been renamed since the tournament
-- (e.g. roster sale, rebrand). tournament_teams.display_name lets each
-- tournament freeze the name used in its participants list / scoreboard
-- so admin and public both show the same, period-correct label.
-- =====================================================

ALTER TABLE tournament_teams ADD COLUMN IF NOT EXISTS display_name TEXT;

-- =====================================================
-- Migration: hierarchical Special Awards (category → award name) + team target
-- Awards previously only supported a free-form name and an optional player.
-- The new `category` is an optional grouping label (e.g. "MVP Awards") and
-- the existing team_id column is now exposed in the admin UI so an award
-- can target a player OR a team.
-- =====================================================

ALTER TABLE tournament_special_awards ADD COLUMN IF NOT EXISTS category TEXT;
