import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { MAP_BOUNDS } from '@/lib/pubg-api'

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const matchId = req.nextUrl.searchParams.get('matchId')
  if (!matchId) return NextResponse.json({ error: 'matchId required' }, { status: 400 })

  const db = serviceClient()

  // 1. Look up the match
  const { data: match, error: matchErr } = await db
    .from('matches')
    .select('id, pubg_match_id, map, status, stage_id')
    .eq('id', matchId)
    .single()

  if (matchErr || !match) {
    return NextResponse.json({ error: 'Match not found', matchErr }, { status: 404 })
  }

  const result: Record<string, unknown> = {
    match: {
      id: match.id,
      pubg_match_id: match.pubg_match_id,
      map: match.map,
      status: match.status,
    },
  }

  // 2. Check existing landing rows in DB
  const { data: existingLandings, error: landingErr } = await db
    .from('match_player_landings')
    .select('id, pubg_player_name, team_id, x_norm, y_norm')
    .eq('match_id', matchId)

  result.existing_landings_in_db = {
    count: existingLandings?.length ?? 0,
    with_team_id: existingLandings?.filter(l => l.team_id).length ?? 0,
    without_team_id: existingLandings?.filter(l => !l.team_id).length ?? 0,
    sample: existingLandings?.slice(0, 5),
    error: landingErr?.message,
  }

  // 3. Check player stats for team mapping
  const { data: playerStats } = await db
    .from('match_player_stats')
    .select('pubg_player_name, team_id, player_id')
    .eq('match_id', matchId)

  result.player_stats = {
    count: playerStats?.length ?? 0,
    with_team_id: playerStats?.filter(p => p.team_id).length ?? 0,
    without_team_id: playerStats?.filter(p => !p.team_id).length ?? 0,
    sample: playerStats?.slice(0, 5),
  }

  if (!match.pubg_match_id) {
    result.telemetry = { error: 'pubg_match_id is null — cannot fetch telemetry' }
    return NextResponse.json(result)
  }

  // 4. Fetch from PUBG API
  const apiKey = process.env.PUBG_API_KEY
  if (!apiKey) {
    result.telemetry = { error: 'PUBG_API_KEY not set' }
    return NextResponse.json(result)
  }

  try {
    const matchRes = await fetch(
      `https://api.pubg.com/shards/tournament/matches/${match.pubg_match_id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json' },
        next: { revalidate: 0 },
      },
    )

    if (!matchRes.ok) {
      result.telemetry = { error: `PUBG API ${matchRes.status}: ${matchRes.statusText}` }
      return NextResponse.json(result)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiData: any = await matchRes.json()
    const mapName: string = apiData.data?.attributes?.mapName ?? ''
    result.map_from_api = mapName
    result.bounds = MAP_BOUNDS[mapName] ?? { width: 816000, height: 816000 }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const telAsset = (apiData.included ?? []).find((item: any) =>
      item.type === 'asset' && item.attributes?.name === 'telemetry'
    )
    const telUrl: string | null = telAsset?.attributes?.URL ?? null
    result.telemetry_url = telUrl ? 'found' : 'NOT FOUND'

    if (!telUrl) return NextResponse.json(result)

    const telRes = await fetch(telUrl, { next: { revalidate: 0 } })
    if (!telRes.ok) {
      result.telemetry = { error: `Telemetry fetch ${telRes.status}` }
      return NextResponse.json(result)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = await telRes.json()

    // Count event types to see what's available
    const eventTypeCounts: Record<string, number> = {}
    for (const ev of events) {
      const t = ev._T ?? 'unknown'
      eventTypeCounts[t] = (eventTypeCounts[t] ?? 0) + 1
    }
    result.event_type_counts = eventTypeCounts

    // Extract landing events
    const bounds = MAP_BOUNDS[mapName] ?? { width: 816000, height: 816000 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const landingEvents = events.filter((ev: any) => ev._T === 'LogParachuteLanding')

    const rawSamples = landingEvents.slice(0, 5).map((ev: {
      character?: { name?: string; location?: { x?: number; y?: number; z?: number } }
    }) => {
      const x = ev.character?.location?.x ?? 0
      const y = ev.character?.location?.y ?? 0
      return {
        player: ev.character?.name,
        raw_x: x,
        raw_y: y,
        norm_x: x / bounds.width,
        norm_y: y / bounds.height,
        norm_y_flipped: 1 - y / bounds.height,
        in_range: x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height,
      }
    })

    result.parachute_landings = {
      count: landingEvents.length,
      sample_raw: rawSamples,
    }

    // Check overall x/y ranges
    if (landingEvents.length > 0) {
      const xs = landingEvents.map((ev: { character?: { location?: { x?: number } } }) =>
        ev.character?.location?.x ?? 0)
      const ys = landingEvents.map((ev: { character?: { location?: { y?: number } } }) =>
        ev.character?.location?.y ?? 0)
      result.coordinate_ranges = {
        x_min: Math.min(...xs),
        x_max: Math.max(...xs),
        y_min: Math.min(...ys),
        y_max: Math.max(...ys),
        bounds_width: bounds.width,
        bounds_height: bounds.height,
        x_norm_range: [Math.min(...xs) / bounds.width, Math.max(...xs) / bounds.width],
        y_norm_range: [Math.min(...ys) / bounds.height, Math.max(...ys) / bounds.height],
      }
    }
  } catch (err) {
    result.telemetry_error = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json(result, { headers: { 'Content-Type': 'application/json' } })
}
