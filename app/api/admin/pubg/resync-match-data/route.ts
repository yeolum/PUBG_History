import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { cookies } from 'next/headers'
import { fetchPubgMatch } from '@/lib/pubg-api'
import { computeTournamentStats } from '@/lib/compute-stats'

export const maxDuration = 300

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

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tournamentId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { tournamentId } = body
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const db = serviceClient()

  // Fetch all imported matches for this tournament
  const { data: stagesData } = await db
    .from('stages')
    .select('id')
    .eq('tournament_id', tournamentId)

  if (!stagesData || stagesData.length === 0) {
    return NextResponse.json({ error: 'No stages found' }, { status: 404 })
  }

  const stageIds = stagesData.map((s) => s.id as string)

  const { data: matchesData } = await db
    .from('matches')
    .select('id, pubg_match_id')
    .in('stage_id', stageIds)
    .eq('status', 'imported')

  if (!matchesData || matchesData.length === 0) {
    return NextResponse.json({ synced: 0, failed: 0 })
  }

  // No telemetry deletion — telemetry data is immutable once computed.
  // Deleting + re-downloading was the primary cause of 504 timeouts on large tournaments.

  let synced = 0
  let failed = 0
  const errors: string[] = []

  // Process matches sequentially to avoid PUBG API rate limits
  for (const match of matchesData) {
    const matchId = match.id as string
    const pubgMatchId = match.pubg_match_id as string

    try {
      const matchData = await fetchPubgMatch(pubgMatchId, 'tournament')

      // Build update rows keyed by pubg_account_id
      const updates = matchData.rosters.flatMap((roster) =>
        roster.participants.map((p) => ({
          match_id: matchId,
          pubg_account_id: p.pubgAccountId,
          pubg_player_name: p.pubgPlayerName,
          kills: p.kills,
          assists: p.assists,
          knocks: p.knocks,
          headshot_kills: p.headshotKills,
          damage_dealt: p.damageDealt,
          survival_time: Math.round(p.survivalTime),
          walk_distance: p.walkDistance,
          ride_distance: p.rideDistance,
          swim_distance: p.swimDistance,
          longest_kill: p.longestKill,
          revives: p.revives,
          heals_used: p.healsUsed,
          boosts_used: p.boostsUsed,
          road_kills: p.roadKills,
          vehicle_destroys: p.vehicleDestroys,
          team_kills: p.teamKills,
          placement: roster.placement,
        }))
      )

      if (updates.length > 0) {
        const { error } = await db
          .from('match_player_stats')
          .upsert(updates, { onConflict: 'match_id,pubg_account_id' })
        if (error) throw new Error(error.message)
      }

      synced++
    } catch (err) {
      failed++
      errors.push(`${pubgMatchId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Recompute aggregated stats
  try {
    await computeTournamentStats(tournamentId, db)
  } catch (err) {
    console.error('[resync-match-data] computeTournamentStats failed:', err)
  }

  revalidateTag('tournament-data', 'default')

  return NextResponse.json({ synced, failed, errors })
}
