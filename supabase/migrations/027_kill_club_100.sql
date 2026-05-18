-- =====================================================
-- 027: 100킬 클럽
-- 한 대회에서 100킬 이상 달성한 선수 기록 (compute-stats 시 자동 집계)
-- =====================================================

CREATE TABLE IF NOT EXISTS kill_club_100 (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     UUID REFERENCES players(id) ON DELETE SET NULL,
  nickname      TEXT NOT NULL,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name     TEXT NOT NULL DEFAULT '',
  logo_url      TEXT,
  kills         INT     NOT NULL DEFAULT 0,
  games         INT     NOT NULL DEFAULT 0,
  damage        NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, nickname)
);
CREATE INDEX IF NOT EXISTS idx_kill_club_100_tournament ON kill_club_100(tournament_id);
ALTER TABLE kill_club_100 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kill_club_100_public_read"   ON kill_club_100;
DROP POLICY IF EXISTS "kill_club_100_service_write" ON kill_club_100;
CREATE POLICY "kill_club_100_public_read"   ON kill_club_100 FOR SELECT USING (true);
CREATE POLICY "kill_club_100_service_write" ON kill_club_100 FOR ALL    USING (auth.role() = 'service_role');
