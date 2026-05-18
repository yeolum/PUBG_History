-- =====================================================
-- 012: Per-tournament Participant Roster
-- 임포트 시 팀/선수 링킹을 해당 대회 등록 명단으로 제한
-- =====================================================

CREATE TABLE IF NOT EXISTS tournament_teams (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_team ON tournament_teams(team_id);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id);

ALTER TABLE tournament_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tournament_teams_public_read"  ON tournament_teams;
DROP POLICY IF EXISTS "tournament_teams_auth_write"   ON tournament_teams;
CREATE POLICY "tournament_teams_public_read" ON tournament_teams FOR SELECT USING (true);
CREATE POLICY "tournament_teams_auth_write"  ON tournament_teams FOR ALL    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tournament_players_public_read" ON tournament_players;
DROP POLICY IF EXISTS "tournament_players_auth_write"  ON tournament_players;
CREATE POLICY "tournament_players_public_read" ON tournament_players FOR SELECT USING (true);
CREATE POLICY "tournament_players_auth_write"  ON tournament_players FOR ALL    USING (auth.uid() IS NOT NULL);
