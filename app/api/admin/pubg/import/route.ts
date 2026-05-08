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

// Extract team tag from player names: ["DNS_Heaven", "DNS_Kill"] → "DNS"
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

  const { stageId, pubgMatchId } = body
  if (!stageId || !pubgMatchId) {
    return NextResponse.json({ error: 'stageId and pubgMatchId are required' }, { status: 400 })
  }

  const db = serviceClient()

  // Duplicate check
  const { data: existing } = await db
    .from('matches')
    .select('id')
    .eq('pubg_match_id', pubgMatchId)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Match ID already imported' }, { status: 409 })
  }

  // Create match record in pending status
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
    return NextResponse.json({ error: 'Failed to create match record' }, { status: 500 })
  }

  // Call PUBG API
  let matchData
  try {
    matchData = await fetchPubgMatch(pubgMatchId, 'tournament')
  } catch (err) {
    await db
      .from('matches')
      .update({ status: 'error', error_msg: err instanceof Error ? err.message : 'API error' })
      .eq('id', matchRecord.id)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PUBG API error' }, { status: 500 })
  }

  // Update match metadata
  await db.from('matches').update({
    match_date: matchData.matchDate,
    map: matchData.map,
    game_mode: matchData.gameMode,
    duration: matchData.duration,
    status: 'imported',
    error_msg: null,
  }).eq('id', matchRecord.id)

  // Resolve the tournament_id this match belongs to so we can scope auto-linking
  // to the tournament's pre-registered participants when they exist.
  const { data: stageRow } = await db
    .from('stages')
    .select('tournament_id')
    .eq('id', stageId)
    .single()
  const tournamentId = stageRow?.tournament_id as string | undefined

  const [{ data: rosterTeamRows }, { data: rosterPlayerRows }] = tournamentId
    ? await Promise.all([
        db.from('tournament_teams').select('team_id').eq('tournament_id', tournamentId),
        db.from('tournament_players').select('player_id').eq('tournament_id', tournamentId),
      ])
    : [{ data: null }, { data: null }]

  const allowedTeamIds: Set<string> | null = (rosterTeamRows && rosterTeamRows.length > 0)
    ? new Set(rosterTeamRows.map((r) => r.team_id as string))
    : null
  const allowedPlayerIds: Set<string> | null = (rosterPlayerRows && rosterPlayerRows.length > 0)
    ? new Set(rosterPlayerRows.map((r) => r.player_id as string))
    : null

  // Build name → ID lookup maps (including aliases, case-insensitive).
  // When a tournament roster exists, restrict the candidate pool to it so
  // colliding tags / nicknames from unrelated teams don't cross-link.
  let teamsQuery = db.from('teams').select('id, name')
  if (allowedTeamIds) teamsQuery = teamsQuery.in('id', [...allowedTeamIds])
  let teamAliasesQuery = db.from('team_aliases').select('alias, team_id')
  if (allowedTeamIds) teamAliasesQuery = teamAliasesQuery.in('team_id', [...allowedTeamIds])
  let playersQuery = db.from('players').select('id, nickname, team_id')
  if (allowedPlayerIds) playersQuery = playersQuery.in('id', [...allowedPlayerIds])
  let playerAliasesQuery = db.from('player_aliases').select('alias, player_id')
  if (allowedPlayerIds) playerAliasesQuery = playerAliasesQuery.in('player_id', [...allowedPlayerIds])

  const [
    { data: teamAliasRows },
    { data: teamRows },
    { data: playerAliasRows },
    { data: playerRows },
  ] = await Promise.all([
    teamAliasesQuery,
    teamsQuery,
    playerAliasesQuery,
    playersQuery,
  ])

  // team name/alias → team_id
  const teamByName: Record<string, string> = {}
  for (const t of teamRows ?? []) teamByName[t.name.toLowerCase()] = t.id
  for (const a of teamAliasRows ?? []) {
    teamByName[a.alias.toLowerCase()] = a.team_id
    // "TAG - Full Name" format → also index the tag part alone
    const dashIdx = a.alias.indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = a.alias.slice(0, dashIdx).trim().toLowerCase()
      if (tagPart && !teamByName[tagPart]) teamByName[tagPart] = a.team_id
    }
  }

  // player nickname/alias variant → player_id[] (multiple per key when ambiguous).
  // Each name (nickname or alias) is indexed under its full lowercased form
  // AND, when it contains an underscore, under the after-first-underscore
  // suffix too. This makes "JoShY-_-" findable both as itself and via
  // "TAG_JoShY-_-" PUBG match names.
  const playerByName: Record<string, string[]> = {}
  // Single-value lookup retained for the team-tag fallback below.
  const playerById: Record<string, string> = {}
  const addName = (name: string, playerId: string) => {
    for (const v of getNameVariants(name)) {
      if (!playerByName[v]) playerByName[v] = []
      if (!playerByName[v].includes(playerId)) playerByName[v].push(playerId)
      // Last-write-wins map preserves the prior `playerById` semantics for
      // the team-resolution fallback path.
      playerById[v] = playerId
    }
  }
  for (const p of playerRows ?? []) addName(p.nickname as string, p.id as string)
  for (const a of playerAliasRows ?? []) addName(a.alias as string, a.player_id as string)

  // player_id → team_id (current team membership)
  const playerTeam: Record<string, string> = {}
  for (const p of playerRows ?? []) {
    if (p.team_id) playerTeam[p.id] = p.team_id
  }

  function resolvePlayerId(pubgName: string): string | null {
    // Try each variant of the input — full first, then after-underscore
    // suffix. Stop at the first variant with at least one match; only
    // accept it if it points to a single player so ambiguous names stay
    // unlinked instead of cross-linking.
    for (const v of getNameVariants(pubgName)) {
      const candidates = playerByName[v] ?? []
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1) return null
    }
    return null
  }

  // Prepare player stat rows
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

  // Prepare team result rows
  const teamResultInserts = matchData.rosters.map((roster) => {
    const participants = roster.participants
    const playerNames = participants.map((p) => p.pubgPlayerName)

    // Extract team tag from player names: "DNS_Heaven" → "DNS"
    const teamTag = extractTeamTag(playerNames) ?? playerNames.join(', ')

    // 1st: look up team by tag
    let resolvedTeamId: string | null = teamByName[teamTag.toLowerCase()] ?? null

    // 2nd: fall back to known player → team membership
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

  // Propagate team_id to player stats
  for (const stat of playerStatInserts) {
    const rosterResult = teamResultInserts.find((t) => t.pubg_roster_id === stat._rosterId)
    stat.team_id = rosterResult?.team_id ?? null
  }

  // Strict filter: when a tournament has a participant roster, only entries
  // that resolved to a registered team / player make it into the DB. Empty
  // sets keep the previous global behavior so older tournaments still import
  // everything.
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

  if (keptTeamResults.length > 0) {
    await db.from('match_team_results').insert(keptTeamResults)
  }
  if (cleanStats.length > 0) {
    await db.from('match_player_stats').insert(cleanStats)
  }

  // Persist resolved pubg_player_name → player_id mappings as aliases
  // so that future Q2 lookups on the player page can find these stats even if player_id is later null
  const playerAliasUpserts = cleanStats
    .filter((s) => s.player_id && s.pubg_player_name)
    .map((s) => ({ player_id: s.player_id as string, alias: s.pubg_player_name as string }))
  if (playerAliasUpserts.length > 0) {
    await db.from('player_aliases').upsert(playerAliasUpserts, { onConflict: 'player_id,alias', ignoreDuplicates: true })
  }

  // Sync each linked player's global team_id to the team they played for in
  // their most recent imported match. Re-importing an old match never moves
  // them off a newer team because the function picks the latest by date.
  const linkedPlayerIds = [...new Set(
    cleanStats.map((s) => s.player_id).filter((pid): pid is string => !!pid)
  )]
  if (linkedPlayerIds.length > 0) {
    await db.rpc('sync_player_current_teams', { player_ids: linkedPlayerIds })
  }

  // Pre-compute team/player stats for the circuit page to read.
  if (tournamentId) {
    try {
      await computeTournamentStats(tournamentId, db)
    } catch (err) {
      console.error('[import] computeTournamentStats failed:', err)
    }
  }

  // Public-page invalidation: a fresh match changes scoreboards, prize totals,
  // team / player profiles, etc. — refresh now instead of waiting 30s.
  revalidateTag('tournament-data', 'default')
  if (tournamentId) revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath('/tournaments')
  revalidatePath('/')

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
