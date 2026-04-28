import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { fetchPubgMatch } from '@/lib/pubg-api'
import { getSuffix } from '@/lib/scoring'
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

  // Build name → ID lookup maps (including aliases, case-insensitive)
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

  // player nickname/alias → player_id (exact match)
  const playerById: Record<string, string> = {}
  for (const p of playerRows ?? []) playerById[p.nickname.toLowerCase()] = p.id
  for (const a of playerAliasRows ?? []) playerById[a.alias.toLowerCase()] = a.player_id

  // player suffix → player_id[] (may have multiple matches)
  const playerBySuffix: Record<string, string[]> = {}
  const addSuffix = (name: string, playerId: string) => {
    const suf = getSuffix(name).toLowerCase()
    if (!playerBySuffix[suf]) playerBySuffix[suf] = []
    if (!playerBySuffix[suf].includes(playerId)) playerBySuffix[suf].push(playerId)
  }
  for (const p of playerRows ?? []) addSuffix(p.nickname, p.id)
  for (const a of playerAliasRows ?? []) addSuffix(a.alias, a.player_id)

  // player_id → team_id (current team membership)
  const playerTeam: Record<string, string> = {}
  for (const p of playerRows ?? []) {
    if (p.team_id) playerTeam[p.id] = p.team_id
  }

  function resolvePlayerId(pubgName: string): string | null {
    // 1. Exact name/alias match
    const exact = playerById[pubgName.toLowerCase()]
    if (exact) return exact
    // 2. Suffix match (unambiguous only)
    const suf = getSuffix(pubgName).toLowerCase()
    const candidates = playerBySuffix[suf] ?? []
    if (candidates.length === 1) return candidates[0]
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

  const cleanStats = playerStatInserts.map(({ _rosterId: _, ...rest }) => rest)

  if (teamResultInserts.length > 0) {
    await db.from('match_team_results').insert(teamResultInserts)
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
    await db.from('player_aliases').upsert(playerAliasUpserts, { onConflict: 'alias', ignoreDuplicates: true })
  }

  const unmatchedTeamNames = teamResultInserts
    .filter((t) => !t.team_id)
    .map((t) => t.pubg_team_name ?? '')

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
