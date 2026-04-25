import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { fetchPubgMatch } from '@/lib/pubg-api'
import { cookies } from 'next/headers'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function majority(values: string[]): string | null {
  if (values.length === 0) return null
  const counts: Record<string, number> = {}
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

// DNS_Heaven → "DNS" (언더스코어 앞 태그 추출)
function extractTeamTag(playerNames: string[]): string | null {
  if (playerNames.length === 0) return null
  const tags = playerNames.map((name) => {
    const idx = name.indexOf('_')
    return idx > 0 ? name.substring(0, idx) : name
  })
  return majority(tags)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  let body: { stageId?: string; pubgMatchId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const { stageId, pubgMatchId } = body
  if (!stageId || !pubgMatchId) {
    return NextResponse.json({ error: 'stageId와 pubgMatchId가 필요합니다' }, { status: 400 })
  }

  const db = serviceClient()

  // 중복 확인
  const { data: existing } = await db
    .from('matches')
    .select('id')
    .eq('pubg_match_id', pubgMatchId)
    .single()

  if (existing) {
    return NextResponse.json({ error: '이미 임포트된 Match ID입니다' }, { status: 409 })
  }

  // matches 레코드 생성 (pending 상태)
  const orderRes = await db
    .from('matches')
    .select('order_num')
    .eq('stage_id', stageId)
    .order('order_num', { ascending: false })
    .limit(1)

  const nextOrder = (orderRes.data?.[0]?.order_num ?? -1) + 1

  const { data: matchRecord, error: insertErr } = await db
    .from('matches')
    .insert([{
      stage_id: stageId,
      pubg_match_id: pubgMatchId,
      status: 'pending',
      order_num: nextOrder,
    }])
    .select()
    .single()

  if (insertErr || !matchRecord) {
    return NextResponse.json({ error: '매치 레코드 생성 실패' }, { status: 500 })
  }

  // PUBG API 호출
  let matchData
  try {
    matchData = await fetchPubgMatch(pubgMatchId, 'tournament')
  } catch (err) {
    await db
      .from('matches')
      .update({ status: 'error', error_msg: err instanceof Error ? err.message : 'API 오류' })
      .eq('id', matchRecord.id)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PUBG API 오류' }, { status: 500 })
  }

  // 매치 메타 업데이트
  await db.from('matches').update({
    match_date: matchData.matchDate,
    map: matchData.map,
    game_mode: matchData.gameMode,
    duration: matchData.duration,
    status: 'imported',
    error_msg: null,
  }).eq('id', matchRecord.id)

  // ── 이름 → ID 룩업 맵 구성 (별칭 포함, 대소문자 무시) ──
  const [
    { data: teamAliasRows },
    { data: teamRows },
    { data: playerAliasRows },
    { data: playerRows },
  ] = await Promise.all([
    db.from('team_aliases').select('alias, team_id'),
    db.from('teams').select('id, name'),
    db.from('player_aliases').select('alias, player_id'),
    db.from('players').select('id, nickname, team_id'),
  ])

  // 팀 이름 → team_id (정식명 + 별칭)
  const teamByName: Record<string, string> = {}
  for (const t of teamRows ?? []) teamByName[t.name.toLowerCase()] = t.id
  for (const a of teamAliasRows ?? []) teamByName[a.alias.toLowerCase()] = a.team_id

  // 선수 닉네임 → player_id (정식 닉네임 + 별칭)
  const playerById: Record<string, string> = {}
  for (const p of playerRows ?? []) playerById[p.nickname.toLowerCase()] = p.id
  for (const a of playerAliasRows ?? []) playerById[a.alias.toLowerCase()] = a.player_id

  // player_id → team_id (현재 소속 팀)
  const playerTeam: Record<string, string> = {}
  for (const p of playerRows ?? []) {
    if (p.team_id) playerTeam[p.id] = p.team_id
  }

  // ── 선수 스탯 먼저 준비 (roster별 선수 → player_id 매핑) ──
  const playerStatInserts = matchData.rosters.flatMap((roster) =>
    roster.participants.map((p) => ({
      match_id: matchRecord.id,
      player_id: playerById[p.pubgPlayerName.toLowerCase()] ?? null,
      team_id: null as string | null,  // 아래 팀 해소 후 채움
      pubg_account_id: p.pubgAccountId,
      pubg_player_name: p.pubgPlayerName,
      kills: p.kills,
      assists: p.assists,
      knocks: p.knocks,
      headshot_kills: p.headshotKills,
      damage_dealt: p.damageDealt,
      survival_time: p.survivalTime,
      walk_distance: p.walkDistance,
      ride_distance: p.rideDistance,
      placement: roster.placement,
      _rosterId: roster.pubgRosterId,  // 내부 계산용, DB엔 안 들어감
    }))
  )

  // ── 팀 결과 준비: 선수 닉네임 태그로 팀 추적 ──
  const teamResultInserts = matchData.rosters.map((roster) => {
    const participants = roster.participants
    const playerNames = participants.map((p) => p.pubgPlayerName)

    // 선수 이름에서 팀 태그 추출 (DNS_Heaven → "DNS")
    const teamTag = extractTeamTag(playerNames) ?? playerNames.join(', ')

    // 1차: 태그로 팀 DB 조회
    let resolvedTeamId: string | null = teamByName[teamTag.toLowerCase()] ?? null

    // 2차: 태그 미매핑 시 선수 소속 팀으로 역추적
    if (!resolvedTeamId) {
      const resolvedPlayerIds = playerNames
        .map((n) => playerById[n.toLowerCase()])
        .filter((id): id is string => !!id)
      const teamCandidates = resolvedPlayerIds
        .map((pid) => playerTeam[pid])
        .filter((tid): tid is string => !!tid)
      resolvedTeamId = majority(teamCandidates) ?? null
    }

    return {
      match_id: matchRecord.id,
      team_id: resolvedTeamId,
      pubg_roster_id: roster.pubgRosterId,
      pubg_team_name: teamTag,  // 팀 태그 (예: "DNS")
      placement: roster.placement,
      total_kills: roster.totalKills,
      total_damage: participants.reduce((s, p) => s + p.damageDealt, 0),
    }
  })

  // 팀 결과 → team_id를 선수 스탯에도 반영
  for (const stat of playerStatInserts) {
    const rosterResult = teamResultInserts.find((t) => t.pubg_roster_id === stat._rosterId)
    stat.team_id = rosterResult?.team_id ?? null
  }

  // DB 삽입 (_rosterId 제거)
  const cleanStats = playerStatInserts.map(({ _rosterId: _, ...rest }) => rest)

  if (teamResultInserts.length > 0) {
    await db.from('match_team_results').insert(teamResultInserts)
  }
  if (cleanStats.length > 0) {
    await db.from('match_player_stats').insert(cleanStats)
  }

  // 미매핑 집계
  const unmatchedTeamNames = teamResultInserts
    .filter((t) => !t.team_id)
    .map((t) => t.pubg_team_name ?? '')  // 선수 이름 목록

  const unmatchedPlayerNames = [...new Set(
    cleanStats.filter((p) => !p.player_id).map((p) => p.pubg_player_name ?? '')
  )]

  return NextResponse.json({
    success: true,
    matchId: matchRecord.id,
    map: matchData.map,
    duration: matchData.duration,
    teamsImported: teamResultInserts.length,
    playersImported: cleanStats.length,
    unmatchedTeams: unmatchedTeamNames,
    unmatchedPlayers: unmatchedPlayerNames,
  })
}
