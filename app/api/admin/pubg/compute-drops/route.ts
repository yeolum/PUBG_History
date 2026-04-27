import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { fetchTelemetryLandings } from '@/lib/pubg-api'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { tournamentId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { tournamentId } = body
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const db = serviceClient()

  // 1. Get all imported matches for this tournament
  const { data: stages } = await db.from('stages').select('id').eq('tournament_id', tournamentId)
  const stageIds = (stages ?? []).map((s: { id: string }) => s.id)
  if (stageIds.length === 0) return NextResponse.json({ message: 'No stages', processed: 0 })

  const { data: matches } = await db
    .from('matches')
    .select('id, pubg_match_id, map')
    .in('stage_id', stageIds)
    .eq('status', 'imported')
    .not('pubg_match_id', 'is', null)

  if (!matches || matches.length === 0) {
    return NextResponse.json({ message: 'No imported matches', processed: 0 })
  }

  // 2. Find matches that already have landing data
  const { data: existingRows } = await db
    .from('match_player_landings')
    .select('match_id')
    .in('match_id', matches.map((m: { id: string }) => m.id))

  const matchesWithData = new Set((existingRows ?? []).map((r: { match_id: string }) => r.match_id))
  const toFetch = matches.filter((m: { id: string }) => !matchesWithData.has(m.id))

  // 3. Fetch telemetry for each new match and store landings
  let processed = 0
  const errors: string[] = []

  for (const match of toFetch) {
    try {
      const { landings } = await fetchTelemetryLandings(match.pubg_match_id, 'tournament')
      if (landings.length === 0) { processed++; continue }

      // Resolve team_id per player from already-imported match stats
      const { data: playerStats } = await db
        .from('match_player_stats')
        .select('pubg_player_name, team_id')
        .eq('match_id', match.id)

      const playerTeamMap = new Map<string, string | null>()
      for (const ps of playerStats ?? []) {
        playerTeamMap.set((ps.pubg_player_name ?? '').toLowerCase(), ps.team_id ?? null)
      }

      const inserts = landings.map((l) => ({
        match_id: match.id,
        pubg_player_name: l.pubgPlayerName,
        team_id: playerTeamMap.get(l.pubgPlayerName.toLowerCase()) ?? null,
        pubg_team_name: null as string | null,
        x_norm: l.xNorm,
        y_norm: l.yNorm,
      }))

      await db.from('match_player_landings').insert(inserts)
      processed++
    } catch (err) {
      errors.push(`${match.pubg_match_id}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  // 4. Aggregate all available landings → median drop locations
  const allMatchIds = matches.map((m: { id: string }) => m.id)
  const { data: allLandings } = await db
    .from('match_player_landings')
    .select('match_id, team_id, x_norm, y_norm')
    .in('match_id', allMatchIds)
    .not('team_id', 'is', null)

  const matchMapLookup = new Map(matches.map((m: { id: string; map: string | null }) => [m.id, m.map ?? '']))

  // Group: mapName → teamId → matchId → positions[]
  type Pos = { x: number; y: number }
  const grouped: Record<string, Record<string, Record<string, Pos[]>>> = {}
  for (const l of allLandings ?? []) {
    const mapName = matchMapLookup.get(l.match_id) ?? 'unknown'
    const teamId = l.team_id as string
    if (!grouped[mapName]) grouped[mapName] = {}
    if (!grouped[mapName][teamId]) grouped[mapName][teamId] = {}
    if (!grouped[mapName][teamId][l.match_id]) grouped[mapName][teamId][l.match_id] = []
    grouped[mapName][teamId][l.match_id].push({ x: l.x_norm as number, y: l.y_norm as number })
  }

  // Median of per-match centroids
  const upserts: { tournament_id: string; team_id: string; map_name: string; x: number; y: number }[] = []
  for (const [mapName, byTeam] of Object.entries(grouped)) {
    for (const [teamId, byMatch] of Object.entries(byTeam)) {
      const centroids = Object.values(byMatch).map((positions) => ({
        x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
        y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
      }))
      upserts.push({
        tournament_id: tournamentId,
        team_id: teamId,
        map_name: mapName,
        x: median(centroids.map((c) => c.x)),
        y: median(centroids.map((c) => c.y)),
      })
    }
  }

  if (upserts.length > 0) {
    await db.from('team_drop_locations').upsert(upserts, {
      onConflict: 'tournament_id,team_id,map_name',
      ignoreDuplicates: false,
    })
  }

  return NextResponse.json({
    success: true,
    totalMatches: matches.length,
    newlyProcessed: processed,
    skipped: matchesWithData.size,
    dropLocationsUpdated: upserts.length,
    errors,
  })
}
