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
  dropLocationsUpdated: number
  errors: string[]
}

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllLandingRows(db: SupabaseClient<any, any, any>, matchIds: string[], selectCols: string, extraFilter?: (q: ReturnType<typeof db.from>) => ReturnType<typeof db.from>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  let pg = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from('match_player_landings').select(selectCols).in('match_id', matchIds).range(pg * PAGE, (pg + 1) * PAGE - 1)
    if (extraFilter) q = extraFilter(q)
    const { data } = await q
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
    pg++
  }
  return rows
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeDropLocations(tournamentId: string, db: SupabaseClient<any, any, any>, opts?: { skipTelemetryFetch?: boolean }): Promise<ComputeDropsResult> {
  const result: ComputeDropsResult = { newlyProcessed: 0, skipped: 0, dropLocationsUpdated: 0, errors: [] }

  const { data: stages } = await db.from('stages').select('id').eq('tournament_id', tournamentId)
  const stageIds = (stages ?? []).map((s: { id: string }) => s.id)
  if (stageIds.length === 0) return result

  const { data: matches } = await db
    .from('matches')
    .select('id, pubg_match_id, map')
    .in('stage_id', stageIds)
    .eq('status', 'imported')
    .not('pubg_match_id', 'is', null)

  if (!matches || matches.length === 0) return result

  // 텔레메트리 다운로드 (매치 임포트 시에만 실행, 새로고침 시에는 건너뜀)
  if (!opts?.skipTelemetryFetch) {
    // 1000행 캡 우회: 페이지네이션으로 전체 match_id 수집
    const existingRows = await fetchAllLandingRows(db, matches.map((m: { id: string }) => m.id), 'match_id')
    const matchesWithData = new Set(existingRows.map((r: { match_id: string }) => r.match_id))
    const toFetch = matches.filter((m: { id: string }) => !matchesWithData.has(m.id))
    result.skipped = matchesWithData.size

    // 5개씩 병렬 처리 — 직렬 대비 ~5배 빠름 (rate limit 안전)
    const CONCURRENCY = 5
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(async (match) => {
          try {
            const { landings } = await fetchTelemetryLandings(match.pubg_match_id, 'tournament')
            if (landings.length === 0) { result.newlyProcessed++; return }

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
            result.newlyProcessed++
          } catch (err) {
            result.errors.push(`${match.pubg_match_id}: ${err instanceof Error ? err.message : 'error'}`)
          }
        }),
      )
    }
  }

  // Aggregate all landings → median drop location per (team, map)
  // 페이지네이션 필수: 80매치 × 64명 = 5120행, 기본 1000행 캡 초과
  const allMatchIds = matches.map((m: { id: string }) => m.id)
  const allLandings = await fetchAllLandingRows(
    db, allMatchIds, 'match_id, team_id, x_norm, y_norm',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.not('team_id', 'is', null),
  )

  const matchMapLookup = new Map(matches.map((m: { id: string; map: string | null }) => [m.id, m.map ?? '']))

  type Pos = { x: number; y: number }
  const grouped: Record<string, Record<string, Record<string, Pos[]>>> = {}
  for (const l of allLandings) {
    const mapName = matchMapLookup.get(l.match_id) ?? 'unknown'
    const teamId = l.team_id as string
    if (!grouped[mapName]) grouped[mapName] = {}
    if (!grouped[mapName][teamId]) grouped[mapName][teamId] = {}
    if (!grouped[mapName][teamId][l.match_id]) grouped[mapName][teamId][l.match_id] = []
    grouped[mapName][teamId][l.match_id].push({ x: l.x_norm as number, y: l.y_norm as number })
  }

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
    result.dropLocationsUpdated = upserts.length
  }

  return result
}
