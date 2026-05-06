# PUBG History — 선수·팀·토너먼트 저장 패턴 참조

이 문서는 PUBG History 프로젝트의 데이터 저장 방식을 정리한 것입니다.
**다른 프로젝트에서 똑같은 구조를 만들 때 이 문서를 Claude에게 전달하세요.**

---

## 기술 스택

- **Next.js 16 App Router** (Turbopack)
- **Supabase** (PostgreSQL + RLS + Storage)
- **TypeScript**
- 인증: Supabase Cookie 기반 (`@supabase/ssr`)
- 이미지: Supabase Storage (`images` 버킷, public)

---

## 데이터베이스 스키마 (최종)

### 핵심 테이블 관계

```
tournaments
  └── stages (tournament_id)
        └── matches (stage_id)
              ├── match_team_results (match_id)
              └── match_player_stats (match_id)

teams
  └── team_aliases (team_id)   ← 같은 팀의 다른 이름들

players
  └── player_aliases (player_id)  ← 같은 선수의 다른 닉네임들

tournament_teams (tournament_id, team_id)   ← 대회 참가 팀 명단
tournament_players (tournament_id, player_id, team_id)  ← 대회 참가 선수 명단
```

---

### teams

```sql
CREATE TABLE teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  short_name   TEXT,          -- 팀 태그 (예: "DNS", "GEN")
  logo_url     TEXT,          -- Supabase Storage URL
  nationality  TEXT,
  league       TEXT,          -- 소속 리그
  description  TEXT,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_aliases (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL UNIQUE,   -- 전역 유니크: 한 alias는 하나의 팀에만 속함
  logo_url  TEXT,                   -- 이 alias 시절의 로고 (과거 팀명용)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**별칭 규칙:**
- `team_aliases.alias`는 전역 UNIQUE → 같은 alias가 두 팀에 붙을 수 없음
- 저장 형식: `"TAG - Full Name"` (예: `"DNS - DNG Esports"`)
- 팀 저장 시 `short_name`과 `name`이 있으면 `"TAG - Name"` alias를 자동 upsert

---

### players

```sql
CREATE TABLE players (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname         TEXT NOT NULL,
  real_name        TEXT,
  nationality      TEXT,
  nationality_code TEXT,   -- 2자리 ISO 코드 (예: "KR", "US")
  birth_date       DATE,
  team_id          UUID REFERENCES teams(id),  -- 현재 소속 팀 (자동 동기화)
  profile_pic      TEXT,   -- Supabase Storage URL
  description      TEXT,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE player_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL UNIQUE,   -- 전역 유니크
  profile_pic TEXT,                   -- 이 닉네임 시절의 프로필 사진
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**`players.team_id` 동기화 규칙:**
- 매치 임포트 후 `sync_player_current_teams(player_ids)` DB 함수 호출
- 가장 최근 임포트된 매치의 `match_player_stats.team_id`로 자동 갱신
- 과거 매치 재임포트는 현재 팀을 바꾸지 않음 (날짜 기준 최신 우선)

---

### tournaments

```sql
CREATE TABLE tournaments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  short_name      TEXT,      -- 짧은 이름 (예: "PGC 2024")
  tag             TEXT,      -- 최단 식별자 (예: "PGC24")
  type            TEXT DEFAULT 'online',   -- 'online' | 'lan' | 'regional' | 'global'
  region          TEXT,
  start_date      DATE,
  end_date        DATE,
  prize_pool      NUMERIC,   -- 숫자만 저장 (통화는 currency 컬럼)
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT DEFAULT 'upcoming', -- 'upcoming' | 'ongoing' | 'completed'
  banner_url      TEXT,      -- Supabase Storage URL
  description     TEXT,
  has_prize       BOOLEAN NOT NULL DEFAULT FALSE,
  has_pgs_points  BOOLEAN NOT NULL DEFAULT FALSE,
  has_pgc_points  BOOLEAN NOT NULL DEFAULT FALSE,
  ranking_method  TEXT DEFAULT 'stage',   -- 'stage' | 'prize' | 'pgs' | 'pgc'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

### stages / matches

```sql
CREATE TABLE stages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  order_num       INTEGER DEFAULT 0,
  tab_order       INTEGER DEFAULT 0,
  type            TEXT DEFAULT 'group',  -- 'group' | 'playoff' | 'grand_final'
  advance_count   INT,    -- 상위 N팀 진출 표시
  eliminate_count INT,    -- 하위 N팀 탈락 표시
  scoring_rule_id UUID REFERENCES scoring_rules(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id      UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  pubg_match_id TEXT UNIQUE,   -- PUBG API Match ID
  match_date    TIMESTAMPTZ,
  map           TEXT,
  game_mode     TEXT,
  duration      INTEGER,       -- 초
  status        TEXT DEFAULT 'pending',  -- 'pending' | 'imported' | 'error'
  order_num     INTEGER DEFAULT 0,
  error_msg     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

### match_team_results / match_player_stats

```sql
CREATE TABLE match_team_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),  -- NULL이면 미연결
  pubg_roster_id  TEXT,
  pubg_team_name  TEXT,    -- PUBG API 원본 팀태그 (예: "DNS")
  display_name    TEXT,    -- 화면 표시용 이름 (매치 시점 팀명)
  placement       INTEGER,
  total_kills     INTEGER DEFAULT 0,
  total_damage    FLOAT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, pubg_roster_id)
);

CREATE TABLE match_player_stats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id        UUID REFERENCES players(id),  -- NULL이면 미연결
  team_id          UUID REFERENCES teams(id),
  pubg_account_id  TEXT,
  pubg_player_name TEXT,   -- PUBG 인게임 이름 원본 (예: "DNS_Heaven")
  display_name     TEXT,   -- 화면 표시용 이름
  kills            INTEGER DEFAULT 0,
  assists          INTEGER DEFAULT 0,
  knocks           INTEGER DEFAULT 0,
  headshot_kills   INTEGER DEFAULT 0,
  damage_dealt     FLOAT DEFAULT 0,
  survival_time    INTEGER DEFAULT 0,
  walk_distance    FLOAT DEFAULT 0,
  ride_distance    FLOAT DEFAULT 0,
  placement        INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, pubg_account_id)
);
```

---

### tournament_teams / tournament_players (대회 참가 명단)

```sql
CREATE TABLE tournament_teams (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  display_name  TEXT,        -- 이 대회 시절 팀명 (리브랜딩 대응)
  disqualified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, team_id)
);

CREATE TABLE tournament_players (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES teams(id),  -- 이 대회에서 소속된 팀
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);
```

**왜 필요한가:**
- 매치 임포트 시 전역 풀 대신 이 명단으로 범위를 제한 → 태그/닉네임 충돌 방지
- `tournament_players.team_id`는 `players.team_id`(현재 팀)와 별개: 트레이드 이후에도 과거 대회는 당시 팀으로 표시

---

### stage_team_standings (VIEW)

```sql
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
  SUM(CASE mtr.placement
    WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 5 WHEN 4 THEN 4
    WHEN 5 THEN 3  WHEN 6 THEN 2 WHEN 7 THEN 1 WHEN 8 THEN 1
    ELSE 0 END) AS placement_points,
  SUM(CASE mtr.placement
    WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 5 WHEN 4 THEN 4
    WHEN 5 THEN 3  WHEN 6 THEN 2 WHEN 7 THEN 1 WHEN 8 THEN 1
    ELSE 0 END + mtr.total_kills) AS total_points
FROM stages s
JOIN matches m ON m.stage_id = s.id AND m.status = 'imported'
JOIN match_team_results mtr ON mtr.match_id = m.id
LEFT JOIN teams t ON t.id = mtr.team_id
WHERE mtr.team_id IS NOT NULL OR mtr.pubg_team_name IS NOT NULL
GROUP BY s.id, s.name, mtr.team_id, t.name, t.short_name, mtr.pubg_team_name
ORDER BY total_points DESC;
```

**점수 공식:** 순위 포인트(1~8위: 10,6,5,4,3,2,1,1 / 9위~: 0) + 킬 수

---

## 매치 임포트 로직 (핵심 패턴)

PUBG API는 팀명을 제공하지 않고 선수 닉네임만 줍니다. 따라서 다음 2단계로 팀을 해소합니다.

### 1단계: 이름 변형 처리 (`getNameVariants`)

PUBG 인게임 이름은 `"TAG_PlayerName"` 형식입니다.

```typescript
// "DNS_Heaven"    → ["dns_heaven", "heaven"]
// "Heaven"        → ["heaven"]
// "DNS_JoShY-_-"  → ["dns_joshy-_-", "joshy-_-"]
function getNameVariants(name: string): string[] {
  const full = name.trim().toLowerCase()
  const out = [full]
  const idx = name.indexOf('_')
  if (idx > 0) {
    const tail = name.substring(idx + 1).trim().toLowerCase()
    if (tail && tail !== full) out.push(tail)
  }
  return out
}
```

### 2단계: 팀 해소 (2중 fallback)

```
1순위: 선수명에서 TAG 추출 → team_aliases / teams.name에서 직접 조회
       예: "DNS_Heaven" → tag="DNS" → teamByName["dns"] → team_id

2순위: 로스터 선수들의 player_id → playerTeam[player_id] → 다수결(majority)
       예: 4명 중 3명이 DNS 소속 → DNS로 판정
```

### 3단계: 선수 해소

```
- getNameVariants로 후보 목록 생성
- 후보가 정확히 1명일 때만 연결 (2명 이상이면 null로 두어 나중에 수동 연결)
```

### 4단계: 임포트 후 자동 처리

```
1. 연결된 선수의 PUBG 인게임명을 player_aliases에 자동 upsert
2. sync_player_current_teams(player_ids) 호출 → players.team_id 최신화
3. revalidateTag/revalidatePath로 공개 페이지 캐시 무효화
```

### 토너먼트 명단 스코핑

- `tournament_teams`, `tournament_players`가 있으면 그 범위 내에서만 매핑
- 없으면 전역 풀에서 매핑 (하위 호환)
- 목적: 다른 대회의 비슷한 팀 태그나 닉네임과 혼동 방지

---

## 별칭(Alias) 시스템

### 팀 별칭

| 상황 | 처리 |
|------|------|
| "Gen.G"와 "Gen.G Esports"가 같은 팀 | `team_aliases`에 둘 다 등록 |
| 팀이 리브랜딩 (DNG → DNS) | 구 이름을 alias로 등록 |
| 표준 형식 | `"TAG - Full Name"` (예: `"DNS - DNG Esports"`) |
| 팀 저장 시 | `short_name`이 있으면 `"TAG - name"` alias 자동 생성 |

### 선수 별칭

| 상황 | 처리 |
|------|------|
| "Heaven" / "H2aven" / "heaven" | `player_aliases`에 모두 등록 |
| 닉네임 변경 | 구 닉네임을 alias로 등록 |
| 임포트 시 | 연결된 PUBG 인게임명을 alias로 자동 upsert |

### 별칭 우선순위 (조회 시)

```
1. players.nickname (정식)
2. player_aliases.alias (등록된 별칭)
3. match_player_stats.pubg_player_name (미연결 원본)
```

---

## TypeScript 핵심 타입

```typescript
export interface Team {
  id: string
  name: string
  short_name: string | null  // 팀 태그
  logo_url: string | null
  nationality: string | null
  league: string | null
  is_active: boolean
  created_at: string; updated_at: string
}

export interface TeamAlias {
  id: string; team_id: string
  alias: string
  logo_url: string | null  // 해당 alias 시절 로고
  created_at: string
}

export interface TeamWithAliases extends Team {
  team_aliases: TeamAlias[]
}

export interface Player {
  id: string
  nickname: string
  real_name: string | null
  nationality: string | null
  nationality_code: string | null  // "KR", "US" 등
  birth_date: string | null
  team_id: string | null           // 현재 소속 팀 (자동 동기화)
  profile_pic: string | null
  is_active: boolean
  created_at: string; updated_at: string
}

export interface PlayerAlias {
  id: string; player_id: string
  alias: string
  profile_pic: string | null  // 해당 닉네임 시절 사진
  created_at: string
}

export interface PlayerWithDetails extends Player {
  player_aliases: PlayerAlias[]
  teams: { id: string; name: string; short_name: string | null } | null
}

export type TournamentStatus = 'upcoming' | 'ongoing' | 'completed'
export type TournamentType = 'online' | 'lan' | 'regional' | 'global'
export type StageType = 'group' | 'playoff' | 'grand_final'
export type MatchStatus = 'pending' | 'imported' | 'error'

export interface Tournament {
  id: string
  name: string
  short_name: string | null
  tag: string | null
  type: TournamentType
  region: string | null
  start_date: string | null; end_date: string | null
  prize_pool: number | null  // 숫자 (통화 기호 없음)
  currency: string           // "USD", "KRW" 등
  status: TournamentStatus
  banner_url: string | null
  description: string | null
  has_prize: boolean; has_pgs_points: boolean; has_pgc_points: boolean
  ranking_method: 'stage' | 'prize' | 'pgs' | 'pgc'
  created_at: string; updated_at: string
}

export interface Stage {
  id: string
  tournament_id: string
  series_id: string | null   // 선택적 그루핑 레이어
  name: string
  order_num: number; tab_order: number
  type: StageType
  advance_count: number | null; eliminate_count: number | null
  scoring_rule_id: string | null
  created_at: string
}

export interface StageTeamStanding {
  stage_id: string; stage_name: string
  team_id: string | null
  team_name: string; team_short_name: string | null
  matches_played: number
  total_kills: number; total_damage: number
  avg_placement: number
  placement_points: number
  total_points: number  // placement_points + total_kills
}
```

---

## Supabase Storage 이미지 패턴

**버킷명:** `images` (public)

| 용도 | 경로 형식 | 예시 |
|------|-----------|------|
| 팀 로고 | `teams/{team_id}/logo.{ext}` | `teams/abc-123/logo.png` |
| 팀 alias 로고 | `teams/{team_id}/alias_{alias}.{ext}` | 과거 팀명 시절 로고 |
| 선수 프로필 사진 | `players/{player_id}/avatar.{ext}` | `players/def-456/avatar.jpg` |
| 대회 배너 | `tournaments/{tournament_id}/banner.{ext}` | |

**업로드 방식:** `upsert: true` (같은 경로에 덮어쓰기)
**캐시 버스팅:** public URL 뒤에 `?t={Date.now()}` 추가

---

## RLS 정책 패턴

모든 테이블에 동일 패턴 적용:

```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

-- 비로그인도 읽기 가능
CREATE POLICY "{table}_public_read" ON {table} FOR SELECT USING (true);

-- 로그인한 사용자만 쓰기 (INSERT/UPDATE/DELETE)
CREATE POLICY "{table}_auth_write" ON {table} FOR ALL USING (auth.uid() IS NOT NULL);
```

**서비스 롤 키** (`SUPABASE_SERVICE_ROLE_KEY`):
- Admin API 라우트에서 사용
- RLS를 완전히 우회
- 절대 클라이언트에 노출 금지

---

## 점수 계산 공식

```typescript
// 기본 PUBG Global Championship 점수
const PLACEMENT_PTS = [10, 6, 5, 4, 3, 2, 1, 1]  // 1~8위, 9위~: 0점

function calcPlacementPts(placement: number): number {
  return placement >= 1 && placement <= 8 ? PLACEMENT_PTS[placement - 1] : 0
}

// 스테이지 총점 = SUM(순위포인트 + 킬수) over all matches
total_points = placement_points + total_kills
```

---

## 환경 변수

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # 클라이언트용 (공개 가능)
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # 서버 전용 (절대 노출 금지)
PUBG_API_KEY=eyJ...                    # PUBG API 키
```

---

## 인증 패턴

- Supabase Email 로그인 (단일 관리자 계정)
- Next.js 16: `middleware.ts` 대신 `proxy.ts` 사용 (`export async function proxy()`)
- 서버 컴포넌트: `@supabase/ssr`의 `createServerClient` + cookie
- 클라이언트 컴포넌트: `createBrowserClient`
- Admin 페이지: `proxy.ts`에서 `/admin/*` 경로 보호

---

## 요약: 이 구조를 새 프로젝트에 그대로 쓰려면

1. **Supabase** 새 프로젝트 생성
2. `supabase/schema.sql` 실행 (기본 테이블 + RLS)
3. `supabase/migration.sql` 실행 (추가 컬럼들, Storage 버킷, 함수들)
4. `.env.local`에 환경변수 3개 설정
5. PUBG API 키 설정
6. `lib/types.ts` 복사
7. `lib/scoring.ts` 복사 (`getNameVariants`, 점수 계산)
8. `app/api/admin/pubg/import/route.ts` 복사 (매치 임포트 로직)
9. Admin 페이지 구조: Tournament → Stage → Match 계층
