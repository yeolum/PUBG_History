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
