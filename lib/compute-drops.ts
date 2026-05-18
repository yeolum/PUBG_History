import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTelemetryLandings } from '@/lib/pubg-api'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export interface ComputeDropsResult {
  newlyProcessed: number
  skipped: number
  stageDropsUpdated: number
  tournamentDropsUpdated: number
  errors: string[]
}

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginateQuery<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const rows: T[] = []
  let pg = 0
  while (true) {
    const { data } = await fetch(pg * PAGE, (pg + 1) * PAGE - 1)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
    pg++
  }
  return rows
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeDropLocations(tournamentId: string, db: SupabaseClient<any, any, any>, opts?: { skipTelemetryFetch?: boolean }): Promise<ComputeDropsResult> {
  const result: ComputeDropsResult = { newlyProcessed: 0, skipped: 0, stageDropsUpdated: 0, tournamentDropsUpdated: 0, errors: [] }

  type MatchRow = { id: string; pubg_match_id: string | null; map: string | null; status: string }
  type StageRow = { id: string; matches: MatchRow[] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stagesRaw } = await (db.from('stages').select('id, matches(id, pubg_match_id, map, status)').eq('tournament_id', tournamentId) as any)
  if (!stagesRaw || stagesRaw.length === 0) return result

  const stages = stagesRaw as StageRow[]
  const allMatches: (MatchRow & { stageId: string })[] = []
  for (const s of stages) {
    for (const m of s.matches ?? []) {
      if (m.status === 'imported' && m.pubg_match_id) {
        allMatches.push({ ...m, stageId: s.id })
      }
    }
  }
  if (allMatches.length === 0) return result

  // Step 2: Telemetry → match_team_drop_locations (skip if already processed)
  if (!opts?.skipTelemetryFetch) {
    const allMatchIds = allMatches.map((m) => m.id)

    const existing = await paginateQuery<{ match_id: string }>(
      (from, to) => db.from('match_team_drop_locations').select('match_id').in('match_id', allMatchIds).order('match_id').range(from, to),
    )
    const processedMatchIds = new Set(existing.map((r) => r.match_id))
    const toFetch = allMatches.filter((m) => !processedMatchIds.has(m.id))
    result.skipped = processedMatchIds.size

    const CONCURRENCY = 5
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(async (match) => {
          try {
            const { landings } = await fetchTelemetryLandings(match.pubg_match_id!, 'tournament')
            if (landings.length === 0) { result.newlyProcessed++; return }

            const { data: playerStats } = await db
              .from('match_player_stats')
              .select('pubg_player_name, team_id')
              .eq('match_id', match.id)

            const playerTeamMap = new Map<string, string | null>()
            for (const ps of playerStats ?? []) {
              playerTeamMap.set((ps.pubg_player_name ?? '').toLowerCase(), ps.team_id ?? null)
            }

            // Archive raw landings
            const landingInserts = landings.map((l) => ({
              match_id: match.id,
              pubg_player_name: l.pubgPlayerName,
              team_id: playerTeamMap.get(l.pubgPlayerName.toLowerCase()) ?? null,
              pubg_team_name: null as string | null,
              x_norm: l.xNorm,
              y_norm: l.yNorm,
            }))
            await db.from('match_player_landings').insert(landingInserts)

            // Compute per-team centroid from in-memory data
            const byTeam = new Map<string, { x: number[]; y: number[] }>()
            for (const l of landings) {
              const teamId = playerTeamMap.get(l.pubgPlayerName.toLowerCase())
              if (!teamId) continue
              if (!byTeam.has(teamId)) byTeam.set(teamId, { x: [], y: [] })
              byTeam.get(teamId)!.x.push(l.xNorm)
              byTeam.get(teamId)!.y.push(l.yNorm)
            }

            const centroidInserts: { match_id: string; team_id: string; map_name: string; x: number; y: number }[] = []
            for (const [teamId, coords] of byTeam.entries()) {
              centroidInserts.push({
                match_id: match.id,
                team_id: teamId,
                map_name: match.map ?? 'unknown',
                x: coords.x.reduce((s, v) => s + v, 0) / coords.x.length,
                y: coords.y.reduce((s, v) => s + v, 0) / coords.y.length,
              })
            }

            if (centroidInserts.length > 0) {
              await db.from('match_team_drop_locations').upsert(centroidInserts, {
                onConflict: 'match_id,team_id',
                ignoreDuplicates: false,
              })
            }
            result.newlyProcessed++
          } catch (err) {
            result.errors.push(`${match.pubg_match_id}: ${err instanceof Error ? err.message : 'error'}`)
          }
        }),
      )
    }
  }

  // Step 3: stage_drop_locations — median of match centroids per stage
  for (const stage of stages) {
    const stageMatchIds = (stage.matches ?? []).filter((m) => m.status === 'imported').map((m) => m.id)
    if (stageMatchIds.length === 0) continue

    const { data: centroids } = await db
      .from('match_team_drop_locations')
      .select('team_id, map_name, x, y')
      .in('match_id', stageMatchIds)

    if (!centroids || centroids.length === 0) continue

    const grouped = new Map<string, { x: number[]; y: number[] }>()
    for (const c of centroids) {
      const key = `${c.team_id}\0${c.map_name}`
      if (!grouped.has(key)) grouped.set(key, { x: [], y: [] })
      grouped.get(key)!.x.push(c.x as number)
      grouped.get(key)!.y.push(c.y as number)
    }

    const stageUpserts: { stage_id: string; team_id: string; map_name: string; x: number; y: number }[] = []
    for (const [key, coords] of grouped.entries()) {
      const sep = key.indexOf('\0')
      stageUpserts.push({
        stage_id: stage.id,
        team_id: key.slice(0, sep),
        map_name: key.slice(sep + 1),
        x: median(coords.x),
        y: median(coords.y),
      })
    }

    if (stageUpserts.length > 0) {
      await db.from('stage_drop_locations').upsert(stageUpserts, {
        onConflict: 'stage_id,team_id,map_name',
        ignoreDuplicates: false,
      })
      result.stageDropsUpdated += stageUpserts.length
    }
  }

  // Step 4: team_drop_locations — median of ALL match centroids for tournament
  const allMatchIds = allMatches.map((m) => m.id)
  const allCentroids = await paginateQuery<{ team_id: string; map_name: string; x: number; y: number }>(
    (from, to) => db
      .from('match_team_drop_locations')
      .select('team_id, map_name, x, y')
      .in('match_id', allMatchIds)
      .order('id')
      .range(from, to),
  )

  const tournamentGrouped = new Map<string, { x: number[]; y: number[] }>()
  for (const c of allCentroids) {
    const key = `${c.team_id}\0${c.map_name}`
    if (!tournamentGrouped.has(key)) tournamentGrouped.set(key, { x: [], y: [] })
    tournamentGrouped.get(key)!.x.push(c.x)
    tournamentGrouped.get(key)!.y.push(c.y)
  }

  const tournamentUpserts: { tournament_id: string; team_id: string; map_name: string; x: number; y: number }[] = []
  for (const [key, coords] of tournamentGrouped.entries()) {
    const sep = key.indexOf('\0')
    tournamentUpserts.push({
      tournament_id: tournamentId,
      team_id: key.slice(0, sep),
      map_name: key.slice(sep + 1),
      x: median(coords.x),
      y: median(coords.y),
    })
  }

  if (tournamentUpserts.length > 0) {
    await db.from('team_drop_locations').upsert(tournamentUpserts, {
      onConflict: 'tournament_id,team_id,map_name',
      ignoreDuplicates: false,
    })
    result.tournamentDropsUpdated = tournamentUpserts.length
  }

  return result
}
