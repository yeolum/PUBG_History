-- =====================================================
-- 028: Pre-computed Tournament Final Standings
-- circuit 페이지가 매번 rankBoard 재계산 없이 rank=1 을 바로 조회
-- =====================================================

CREATE TABLE IF NOT EXISTS tournament_final_standings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  rank          INT  NOT NULL,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name     TEXT NOT NULL,
  logo_url      TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_tournament_final_standings_tournament ON tournament_final_standings(tournament_id);
ALTER TABLE tournament_final_standings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tournament_final_standings_public_read"   ON tournament_final_standings;
DROP POLICY IF EXISTS "tournament_final_standings_service_write" ON tournament_final_standings;
CREATE POLICY "tournament_final_standings_public_read"   ON tournament_final_standings FOR SELECT USING (true);
CREATE POLICY "tournament_final_standings_service_write" ON tournament_final_standings FOR ALL    USING (auth.role() = 'service_role');
