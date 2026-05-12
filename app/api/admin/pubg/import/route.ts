import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidatePath, revalidateTag } from 'next/cache'
import { fetchPubgMatch } from '@/lib/pubg-api'
import { getNameVariants } from '@/lib/scoring'
import { cookies } from 'next/headers'
import { computeTournamentStats } from '@/lib/compute-stats'

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
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { stageId?: string; pubgMatchId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request format' }, { status: 400 })
  }

  const { stageId, pubgMatchId, skipStats } = body as { stageId?: string; pubgMatchId?: string; skipStats?: boolean }
  if (!stageId || !pubgMatchId) {
    return NextResponse.json({ error: 'stageId and pubgMatchId are required' }, { status: 400 })
  }

  const db = serviceClient()

  // ── Phase 1: Run all independent initial queries in parallel ─────────────
  const [
    { data: existing },
    orderRes,
    { data: stageRow },
  ] = await Promise.all([
    db.from('matches').select('id').eq('pubg_match_id', pubgMatchId).maybeSingle(),
    db.from('matches').select('order_num').eq('stage_id', stageId).order('order_num', { ascending: false }).limit(1),
    db.from('stages').select('tournament_id').eq('id', stageId).single(),
  ])

  if (existing) {
    return NextResponse.json({ error: 'Match ID already imported' }, { status: 409 })
  }

  const tournamentId = stageRow?.tournament_id as string | undefined
  const nextOrder = (orderRes.data?.[0]?.order_num ?? -1) + 1

  // ── Phase 2: Create pending match record ─────────────────────────────────
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
    return NextResponse.json({ error: 'Failed to create match record' }, { status: 500 })
  }

  // ── Phase 3: PUBG API call + tournament roster fetch in parallel ──────────
  // The PUBG API call is the single slowest step (~1–3 s). We overlap it with
  // the roster lookup so neither blocks the other.
  const rosterFetch = tournamentId
    ? Promise.all([
        db.from('tournament_teams').select('team_id').eq('tournament_id', tournamentId),
        db.from('tournament_players').select('player_id').eq('tournament_id', tournamentId),
      ])
    : Promise.resolve([{ data: null as { team_id: string }[] | null }, { data: null as { player_id: string }[] | null }] as const)

  let matchData
  let rosterResult: readonly [{ data: { team_id: string }[] | null }, { data: { player_id: string }[] | null }]
  try {
    ;[matchData, rosterResult] = await Promise.all([
      fetchPubgMatch(pubgMatchId, 'tournament'),
      rosterFetch,
    ])
  } catch (err) {
    await db
      .from('matches')
      .update({ status: 'error', error_msg: err instanceof Error ? err.message : 'API error' })
      .eq('id', matchRecord.id)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PUBG API error' }, { status: 500 })
  }

  const [{ data: rosterTeamRows }, { data: rosterPlayerRows }] = rosterResult

  const allowedTeamIds: Set<string> | null = (rosterTeamRows && rosterTeamRows.length > 0)
    ? new Set(rosterTeamRows.map((r) => r.team_id as string))
    : null
  const allowedPlayerIds: Set<string> | null = (rosterPlayerRows && rosterPlayerRows.length > 0)
    ? new Set(rosterPlayerRows.map((r) => r.player_id as string))
    : null

  // ── Phase 4: Update match metadata + fetch lookup maps in parallel ────────
  let teamsQuery = db.from('teams').select('id, name')
  if (allowedTeamIds) teamsQuery = teamsQuery.in('id', [...allowedTeamIds])
  let teamAliasesQuery = db.from('team_aliases').select('alias, team_id')
  if (allowedTeamIds) teamAliasesQuery = teamAliasesQuery.in('team_id', [...allowedTeamIds])
  let playersQuery = db.from('players').select('id, nickname, team_id')
  if (allowedPlayerIds) playersQuery = playersQuery.in('id', [...allowedPlayerIds])
  let playerAliasesQuery = db.from('player_aliases').select('alias, player_id')
  if (allowedPlayerIds) playerAliasesQuery = playerAliasesQuery.in('player_id', [...allowedPlayerIds])

  const [
    [{ data: teamAliasRows }, { data: teamRows }, { data: playerAliasRows }, { data: playerRows }],
  ] = await Promise.all([
    Promise.all([teamAliasesQuery, teamsQuery, playerAliasesQuery, playersQuery]),
    db.from('matches').update({
      match_date: matchData.matchDate,
      map: matchData.map,
      game_mode: matchData.gameMode,
      duration: matchData.duration,
      status: 'imported',
      error_msg: null,
    }).eq('id', matchRecord.id),
  ])

  // ── Phase 5: Build lookup maps and prepare insert rows (in-memory) ────────
  const teamByName: Record<string, string> = {}
  for (const t of teamRows ?? []) teamByName[t.name.toLowerCase()] = t.id
  for (const a of teamAliasRows ?? []) {
    teamByName[a.alias.toLowerCase()] = a.team_id
    const dashIdx = a.alias.indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = a.alias.slice(0, dashIdx).trim().toLowerCase()
      if (tagPart && !teamByName[tagPart]) teamByName[tagPart] = a.team_id
    }
  }

  const playerByName: Record<string, string[]> = {}
  const playerById: Record<string, string> = {}
  const addName = (name: string, playerId: string) => {
    for (const v of getNameVariants(name)) {
      if (!playerByName[v]) playerByName[v] = []
      if (!playerByName[v].includes(playerId)) playerByName[v].push(playerId)
      playerById[v] = playerId
    }
  }
  for (const p of playerRows ?? []) addName(p.nickname as string, p.id as string)
  for (const a of playerAliasRows ?? []) addName(a.alias as string, a.player_id as string)

  const playerTeam: Record<string, string> = {}
  for (const p of playerRows ?? []) {
    if (p.team_id) playerTeam[p.id] = p.team_id
  }

  function resolvePlayerId(pubgName: string): string | null {
    for (const v of getNameVariants(pubgName)) {
      const candidates = playerByName[v] ?? []
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1) return null
    }
    return null
  }

  const playerStatInserts = matchData.rosters.flatMap((roster) =>
    roster.participants.map((p) => ({
      match_id: matchRecord.id,
      player_id: resolvePlayerId(p.pubgPlayerName),
      team_id: null as string | null,
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
      _rosterId: roster.pubgRosterId,
    }))
  )

  const teamResultInserts = matchData.rosters.map((roster) => {
    const participants = roster.participants
    const playerNames = participants.map((p) => p.pubgPlayerName)
    const teamTag = extractTeamTag(playerNames) ?? playerNames.join(', ')

    let resolvedTeamId: string | null = teamByName[teamTag.toLowerCase()] ?? null
    if (!resolvedTeamId) {
      const resolvedPlayerIds = playerNames
        .map((n) => playerById[n.toLowerCase()])
        .filter((id): id is string => !!id)
      const teamCandidates = resolvedPlayerIds
        .map((pid) => playerTeam[pid])
        .filter((tid): tid is string => !!tid)
        .filter((tid) => !allowedTeamIds || allowedTeamIds.has(tid))
      resolvedTeamId = majority(teamCandidates) ?? null
    }

    return {
      match_id: matchRecord.id,
      team_id: resolvedTeamId,
      pubg_roster_id: roster.pubgRosterId,
      pubg_team_name: teamTag,
      placement: roster.placement,
      total_kills: roster.totalKills,
      total_damage: participants.reduce((s, p) => s + p.damageDealt, 0),
    }
  })

  for (const stat of playerStatInserts) {
    const rosterResult = teamResultInserts.find((t) => t.pubg_roster_id === stat._rosterId)
    stat.team_id = rosterResult?.team_id ?? null
  }

  const keptTeamResults = allowedTeamIds
    ? teamResultInserts.filter((t) => t.team_id && allowedTeamIds.has(t.team_id))
    : teamResultInserts
  const keptRosterIds = new Set(keptTeamResults.map((t) => t.pubg_roster_id))

  const keptStatInserts = playerStatInserts.filter((s) => {
    if (allowedTeamIds && !keptRosterIds.has(s._rosterId)) return false
    if (allowedPlayerIds && (!s.player_id || !allowedPlayerIds.has(s.player_id))) return false
    return true
  })

  const droppedTeamNames = teamResultInserts
    .filter((t) => !keptTeamResults.includes(t))
    .map((t) => t.pubg_team_name ?? '')
  const droppedPlayerNames = [...new Set(
    playerStatInserts
      .filter((s) => !keptStatInserts.includes(s))
      .map((s) => s.pubg_player_name ?? '')
      .filter(Boolean)
  )]

  const cleanStats = keptStatInserts.map(({ _rosterId: _, ...rest }) => rest)

  const playerAliasUpserts = cleanStats
    .filter((s) => s.player_id && s.pubg_player_name)
    .map((s) => ({ player_id: s.player_id as string, alias: s.pubg_player_name as string }))

  // ── Phase 6: All inserts in parallel ─────────────────────────────────────
  await Promise.all([
    keptTeamResults.length > 0
      ? db.from('match_team_results').insert(keptTeamResults)
      : Promise.resolve(),
    cleanStats.length > 0
      ? db.from('match_player_stats').insert(cleanStats)
      : Promise.resolve(),
    playerAliasUpserts.length > 0
      ? db.from('player_aliases').upsert(playerAliasUpserts, { onConflict: 'player_id,alias', ignoreDuplicates: true })
      : Promise.resolve(),
  ])

  // ── Phase 7: Post-insert operations (sequential: each depends on prior) ──
  const linkedPlayerIds = [...new Set(
    cleanStats.map((s) => s.player_id).filter((pid): pid is string => !!pid)
  )]
  if (linkedPlayerIds.length > 0) {
    await db.rpc('sync_player_current_teams', { player_ids: linkedPlayerIds })
  }

  // skipStats=true when this is not the last match in a bulk import — avoids
  // running computeTournamentStats N times when importing N matches at once.
  // The caller is responsible for running stats on the final import.
  if (!skipStats && tournamentId) {
    try {
      await computeTournamentStats(tournamentId, db)
    } catch (err) {
      console.error('[import] computeTournamentStats failed:', err)
    }
  }

  if (!skipStats) {
    revalidateTag('tournament-data', 'default')
    if (tournamentId) revalidatePath(`/tournaments/${tournamentId}`)
    revalidatePath('/tournaments')
    revalidatePath('/')
  }

  return NextResponse.json({
    success: true,
    matchId: matchRecord.id,
    map: matchData.map,
    duration: matchData.duration,
    teamsImported: keptTeamResults.length,
    playersImported: cleanStats.length,
    droppedTeams: droppedTeamNames,
    droppedPlayers: droppedPlayerNames,
  })
}
