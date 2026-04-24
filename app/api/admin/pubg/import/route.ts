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

export async function POST(req: NextRequest) {
  // 인증 확인
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
    matchData = await fetchPubgMatch(pubgMatchId, 'kakao')
  } catch (err) {
    // 오류 상태로 업데이트
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

  // 팀/선수 이름 → DB ID 매핑 (aliases 포함)
  const { data: teamAliases } = await db.from('team_aliases').select('alias, team_id')
  const { data: teams } = await db.from('teams').select('id, name')
  const { data: playerAliases } = await db.from('player_aliases').select('alias, player_id')
  const { data: players } = await db.from('players').select('id, nickname')

  // 이름 → ID 룩업 맵 생성
  const teamLookup: Record<string, string> = {}
  for (const t of teams ?? []) teamLookup[t.name.toLowerCase()] = t.id
  for (const a of teamAliases ?? []) teamLookup[a.alias.toLowerCase()] = a.team_id

  const playerLookup: Record<string, string> = {}
  for (const p of players ?? []) playerLookup[p.nickname.toLowerCase()] = p.id
  for (const a of playerAliases ?? []) playerLookup[a.alias.toLowerCase()] = a.player_id

  // 팀 결과 삽입
  const teamResultInserts = matchData.rosters.map((roster) => {
    const teamId = teamLookup[roster.pubgRosterId.toLowerCase()] ?? null
    // Roster ID 대신 참가자 이름으로 팀 매핑 시도
    const firstPlayer = roster.participants[0]?.pubgPlayerName ?? ''
    const teamIdByPlayer = playerLookup[firstPlayer.toLowerCase()]
      ? null  // 선수로는 팀 ID 못 구함, 별도 처리
      : null

    return {
      match_id: matchRecord.id,
      team_id: teamId ?? teamIdByPlayer ?? null,
      pubg_roster_id: roster.pubgRosterId,
      pubg_team_name: null as string | null,  // PUBG API에서 팀 이름 직접 제공 안 함
      placement: roster.placement,
      total_kills: roster.totalKills,
      total_damage: roster.participants.reduce((s, p) => s + p.damageDealt, 0),
    }
  })

  if (teamResultInserts.length > 0) {
    await db.from('match_team_results').insert(teamResultInserts)
  }

  // 선수 스탯 삽입 (roster별로 placement 포함)
  const playerStatInserts = matchData.rosters.flatMap((roster) => {
    // 이 roster에 연결된 team_id 찾기
    const rosterTeamId = teamResultInserts.find(
      (t) => t.pubg_roster_id === roster.pubgRosterId
    )?.team_id ?? null

    return roster.participants.map((p) => ({
      match_id: matchRecord.id,
      player_id: playerLookup[p.pubgPlayerName.toLowerCase()] ?? null,
      team_id: rosterTeamId,
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
    }))
  })

  if (playerStatInserts.length > 0) {
    await db.from('match_player_stats').insert(playerStatInserts)
  }

  // 미매핑 팀/선수 집계
  const unmatchedTeams = teamResultInserts
    .filter((t) => !t.team_id)
    .map((t) => t.pubg_roster_id)

  const unmatchedPlayers = playerStatInserts
    .filter((p) => !p.player_id)
    .map((p) => p.pubg_player_name)

  return NextResponse.json({
    success: true,
    matchId: matchRecord.id,
    map: matchData.map,
    duration: matchData.duration,
    teamsImported: teamResultInserts.length,
    playersImported: playerStatInserts.length,
    unmatchedTeams,
    unmatchedPlayers: [...new Set(unmatchedPlayers)],
  })
}
