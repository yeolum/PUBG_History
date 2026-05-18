-- =====================================================
-- 013: Tournament-scoped Player Team + Sync Function
-- tournament_players.team_id : 해당 대회에서 소속 팀
-- sync_player_current_teams  : 가장 최근 경기 기준으로 players.team_id 자동 갱신
-- =====================================================

ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

UPDATE tournament_players tp
SET team_id = (SELECT p.team_id FROM players p WHERE p.id = tp.player_id)
WHERE tp.team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_players_team_id ON tournament_players(team_id);

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
  SET team_id    = latest.team_id,
      updated_at = NOW()
  FROM latest
  WHERE p.id = latest.player_id
    AND p.team_id IS DISTINCT FROM latest.team_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 데이터 backfill
SELECT sync_player_current_teams(ARRAY(SELECT id FROM players));
