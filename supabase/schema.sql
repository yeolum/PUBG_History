-- =====================================================
-- PUBG History Database Schema
-- Supabase 대시보드 > SQL Editor에서 실행하세요
-- =====================================================

-- UUID 확장 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 팀 (Teams)
-- =====================================================
CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  short_name TEXT,
  logo_url   TEXT,
  nationality TEXT,
  description TEXT,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 팀 이름 별칭 (다른 이름으로 등록된 같은 팀 연결용)
CREATE TABLE team_aliases (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id  UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias    TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 선수 (Players)
-- =====================================================
CREATE TABLE players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname    TEXT NOT NULL,
  real_name   TEXT,
  nationality TEXT,
  birth_date  DATE,
  team_id     UUID REFERENCES teams(id),
  profile_pic TEXT,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 선수 닉네임 별칭 (다른 닉네임의 같은 선수 연결용)
CREATE TABLE player_aliases (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 대회 (Tournaments)
-- =====================================================
CREATE TABLE tournaments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  short_name  TEXT,
  type        TEXT DEFAULT 'online',  -- 'online' | 'lan' | 'regional' | 'global'
  region      TEXT,
  start_date  DATE,
  end_date    DATE,
  prize_pool  TEXT,
  status      TEXT DEFAULT 'upcoming', -- 'upcoming' | 'ongoing' | 'completed'
  banner_url  TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 시리즈 (Series) - 대회 내 단계
-- =====================================================
CREATE TABLE series (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  order_num     INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 스테이지 (Stages) - 시리즈 내 단계
-- =====================================================
CREATE TABLE stages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  order_num INTEGER DEFAULT 0,
  type      TEXT DEFAULT 'group',  -- 'group' | 'playoff' | 'grand_final'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 매치 (Matches) - PUBG API matchId로 연결
-- =====================================================
CREATE TABLE matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id      UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  pubg_match_id TEXT UNIQUE,
  match_date    TIMESTAMPTZ,
  map           TEXT,
  game_mode     TEXT,
  duration      INTEGER,  -- 초
  status        TEXT DEFAULT 'pending',  -- 'pending' | 'imported' | 'error'
  order_num     INTEGER DEFAULT 0,
  error_msg     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 매치별 팀 결과
-- =====================================================
CREATE TABLE match_team_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  pubg_roster_id  TEXT,
  pubg_team_name  TEXT,  -- PUBG API에서 가져온 팀 이름 (링크 전 원본)
  placement       INTEGER,
  total_kills     INTEGER DEFAULT 0,
  total_damage    FLOAT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, pubg_roster_id)
);

-- =====================================================
-- 매치별 선수 스탯
-- =====================================================
CREATE TABLE match_player_stats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id        UUID REFERENCES players(id),
  team_id          UUID REFERENCES teams(id),
  pubg_account_id  TEXT,
  pubg_player_name TEXT,  -- PUBG 인게임 이름 (링크 전 원본)
  kills            INTEGER DEFAULT 0,
  assists          INTEGER DEFAULT 0,
  knocks           INTEGER DEFAULT 0,
  headshot_kills   INTEGER DEFAULT 0,
  damage_dealt     FLOAT DEFAULT 0,
  survival_time    INTEGER DEFAULT 0,  -- 초
  walk_distance    FLOAT DEFAULT 0,
  ride_distance    FLOAT DEFAULT 0,
  placement        INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, pubg_account_id)
);

-- =====================================================
-- 인덱스
-- =====================================================
CREATE INDEX idx_team_aliases_alias ON team_aliases(alias);
CREATE INDEX idx_player_aliases_alias ON player_aliases(alias);
CREATE INDEX idx_series_tournament ON series(tournament_id);
CREATE INDEX idx_stages_series ON stages(series_id);
CREATE INDEX idx_matches_stage ON matches(stage_id);
CREATE INDEX idx_matches_pubg_id ON matches(pubg_match_id);
CREATE INDEX idx_match_team_results_match ON match_team_results(match_id);
CREATE INDEX idx_match_team_results_team ON match_team_results(team_id);
CREATE INDEX idx_match_player_stats_match ON match_player_stats(match_id);
CREATE INDEX idx_match_player_stats_player ON match_player_stats(player_id);
CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);

-- =====================================================
-- updated_at 자동 갱신 함수
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER players_updated_at BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_team_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_player_stats ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 허용 (비로그인 사용자도 조회 가능)
CREATE POLICY "public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "public read team_aliases" ON team_aliases FOR SELECT USING (true);
CREATE POLICY "public read players" ON players FOR SELECT USING (true);
CREATE POLICY "public read player_aliases" ON player_aliases FOR SELECT USING (true);
CREATE POLICY "public read tournaments" ON tournaments FOR SELECT USING (true);
CREATE POLICY "public read series" ON series FOR SELECT USING (true);
CREATE POLICY "public read stages" ON stages FOR SELECT USING (true);
CREATE POLICY "public read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "public read match_team_results" ON match_team_results FOR SELECT USING (true);
CREATE POLICY "public read match_player_stats" ON match_player_stats FOR SELECT USING (true);

-- 인증된 사용자만 쓰기 가능 (서비스 롤 키로 우회 가능)
CREATE POLICY "auth write teams" ON teams FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write team_aliases" ON team_aliases FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write players" ON players FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write player_aliases" ON player_aliases FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write tournaments" ON tournaments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write series" ON series FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write stages" ON stages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write matches" ON matches FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write match_team_results" ON match_team_results FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth write match_player_stats" ON match_player_stats FOR ALL USING (auth.role() = 'authenticated');

-- =====================================================
-- 스테이지 팀 순위 뷰 (매치 데이터 집계)
-- =====================================================
CREATE VIEW stage_team_standings AS
SELECT
  s.id AS stage_id,
  s.name AS stage_name,
  mtr.team_id,
  t.name AS team_name,
  t.short_name AS team_short_name,
  COUNT(DISTINCT m.id) AS matches_played,
  SUM(mtr.total_kills) AS total_kills,
  ROUND(SUM(mtr.total_damage)::numeric, 1) AS total_damage,
  AVG(mtr.placement) AS avg_placement,
  -- 표준 PUBG 점수: 순위 포인트 + 킬 포인트
  SUM(
    CASE mtr.placement
      WHEN 1 THEN 15
      WHEN 2 THEN 12
      WHEN 3 THEN 10
      WHEN 4 THEN 8
      WHEN 5 THEN 6
      WHEN 6 THEN 4
      WHEN 7 THEN 2
      ELSE 1
    END + mtr.total_kills
  ) AS total_points
FROM stages s
JOIN matches m ON m.stage_id = s.id AND m.status = 'imported'
JOIN match_team_results mtr ON mtr.match_id = m.id
LEFT JOIN teams t ON t.id = mtr.team_id
WHERE mtr.team_id IS NOT NULL
GROUP BY s.id, s.name, mtr.team_id, t.name, t.short_name
ORDER BY total_points DESC;
