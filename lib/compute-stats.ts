import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof createSupabaseClient<any, any, any>>

const PAGE = 1000
const ID_CHUNK = 80
const BATCH = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

async function fetchPaged<T>(query: any): Promise<T[]> {
  const rows: T[] = []
  let page = 0
  while (true) {
    const { data: batch } = await query.order('id').range(page * PAGE, (page + 1) * PAGE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as T[]))
    if (batch.length < PAGE) break
    page++
  }
  return rows
}

async function fetchInChunked<T>(build: (chunk: string[]) => any, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let off = 0; off < ids.length; off += ID_CHUNK) chunks.push(ids.slice(off, off + ID_CHUNK))
  const out = await Promise.all(chunks.map((c) => fetchPaged<T>(build(c))))
  return out.flat()
}

interface PlayerStatsEntry {
  player_id: string | null
  nickname: string
  team_id: string | null
  team_name: string
  logo_url: string | null
  games: number
  kills: number
  assists: number
  knocks: number
  headshot_kills: number
  damage: number
  survival_time: number
}

function aggregatePlayerStats(
  rows: AnyRow[],
  displayNameByTeam: Map<string, string>,
  accountIdToPlayerId: Map<string, string>,
): Map<string, PlayerStatsEntry> {
  const map = new Map<string, PlayerStatsEntry>()
  for (const d of rows) {
    let resolvedPlayerId = (d.player_id ?? null) as string | null
    if (!resolvedPlayerId && d.pubg_account_id) {
      resolvedPlayerId = accountIdToPlayerId.get(d.pubg_account_id as string) ?? null
    }
    const key = resolvedPlayerId ?? `pubg:${(d.pubg_player_name as string ?? '').toLowerCase()}`
    const teamName =
      (d.team_id ? (displayNameByTeam.get(d.team_id as string) ?? null) : null) ??
      ((d.teams as AnyRow | null)?.name ?? '') as string
    const ex: PlayerStatsEntry = map.get(key) ?? {
      player_id: resolvedPlayerId,
      nickname: ((d.players as AnyRow | null)?.nickname ?? d.pubg_player_name ?? '?') as string,
      team_id: (d.team_id ?? null) as string | null,
      team_name: teamName,
      logo_url: ((d.teams as AnyRow | null)?.logo_url ?? null) as string | null,
      games: 0, kills: 0, assists: 0, knocks: 0, headshot_kills: 0, damage: 0, survival_time: 0,
    }
    ex.games++
    ex.kills += (d.kills as number) ?? 0
    ex.assists += (d.assists as number) ?? 0
    ex.knocks += (d.knocks as number) ?? 0
    ex.headshot_kills += (d.headshot_kills as number) ?? 0
    ex.damage += Number(d.damage_dealt ?? 0)
    ex.survival_time += Number(d.survival_time ?? 0)
    map.set(key, ex)
  }
  return map
}

async function insertPlayerRows(db: DB, table: string, rows: AnyRow[]): Promise<void> {
  for (let off = 0; off < rows.length; off += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from(table).insert(rows.slice(off, off + BATCH) as any)
    if (error) console.error(`[compute-stats] ${table} insert failed:`, error.message)
  }
}

export async function computeTournamentStats(tournamentId: string, db: DB): Promise<void> {
  // Fetch stages (all, not just total — stage stats cover every stage)
  const { data: stagesData } = await db
    .from('stages')
    .select('id, series_id, include_in_total')
    .eq('tournament_id', tournamentId)
  const stages = (stagesData ?? []) as AnyRow[]
  const stageIds = stages.map((s) => s.id as string)

  // Fetch series
  const { data: seriesData } = await db
    .from('series')
    .select('id')
    .eq('tournament_id', tournamentId)
  const seriesList = (seriesData ?? []) as AnyRow[]
  const seriesIds = seriesList.map((s) => s.id as string)

  // Clear all pre-computed tables for this tournament's stages/series
  await Promise.all([
    stageIds.length > 0
      ? db.from('stage_player_stats').delete().in('stage_id', stageIds)
      : Promise.resolve(),
    seriesIds.length > 0
      ? db.from('series_player_stats').delete().in('series_id', seriesIds)
      : Promise.resolve(),
    db.from('tournament_team_stats').delete().eq('tournament_id', tournamentId),
    db.from('tournament_player_stats').delete().eq('tournament_id', tournamentId),
  ])

  if (stageIds.length === 0) return

  // Fetch ALL imported matches (including excluded-from-total stages, needed for stage stats)
  const allMatches = await fetchInChunked<AnyRow>(
    (chunk) => db.from('matches').select('id, stage_id, status').in('stage_id', chunk),
    stageIds,
  )

  // Group match IDs by stage
  const matchIdsByStage = new Map<string, string[]>()
  for (const m of allMatches) {
    if (m.status !== 'imported') continue
    const sid = m.stage_id as string
    if (!matchIdsByStage.has(sid)) matchIdsByStage.set(sid, [])
    matchIdsByStage.get(sid)!.push(m.id as string)
  }

  const allImportedMatchIds = allMatches
    .filter((m) => m.status === 'imported')
    .map((m) => m.id as string)

  // Tournament-total match IDs (exclude stages with include_in_total === false)
  const excludedStageIds = new Set(
    stages.filter((s) => s.include_in_total === false).map((s) => s.id as string),
  )
  const totalMatchIds = allMatches
    .filter((m) => m.status === 'imported' && !excludedStageIds.has(m.stage_id as string))
    .map((m) => m.id as string)

  if (allImportedMatchIds.length === 0) return

  // Fetch display names override
  const { data: ttData } = await db
    .from('tournament_teams')
    .select('team_id, display_name')
    .eq('tournament_id', tournamentId)
  const displayNameByTeam = new Map<string, string>()
  for (const tt of (ttData ?? []) as AnyRow[]) {
    if (tt.team_id && tt.display_name) displayNameByTeam.set(tt.team_id as string, tt.display_name as string)
  }

  // Fetch ALL player stats (match, teams, players joins) for all imported matches
  const PS_SELECT = 'match_id, player_id, pubg_account_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, players(id, nickname), teams(id, name, logo_url)'

  const [trData, allPsData] = await Promise.all([
    // Team results only needed for tournament-total computation
    totalMatchIds.length > 0
      ? fetchInChunked<AnyRow>(
          (chunk) =>
            db
              .from('match_team_results')
              .select('match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
              .in('match_id', chunk),
          totalMatchIds,
        )
      : Promise.resolve([]),
    fetchInChunked<AnyRow>(
      (chunk) => db.from('match_player_stats').select(PS_SELECT).in('match_id', chunk),
      allImportedMatchIds,
    ),
  ])

  // Build account_id → player_id from any linked row (stable across renames)
  const accountIdToPlayerId = new Map<string, string>()
  for (const d of allPsData) {
    if (d.player_id && d.pubg_account_id) {
      accountIdToPlayerId.set(d.pubg_account_id as string, d.player_id as string)
    }
  }

  // Group player stat rows by match_id for stage/series aggregation
  const psByMatch = new Map<string, AnyRow[]>()
  for (const d of allPsData) {
    const mid = d.match_id as string
    if (!psByMatch.has(mid)) psByMatch.set(mid, [])
    psByMatch.get(mid)!.push(d)
  }

  const now = new Date().toISOString()

  // ── 1. Stage player stats ─────────────────────────────────────────
  for (const stage of stages) {
    const matchIds = matchIdsByStage.get(stage.id as string) ?? []
    if (matchIds.length === 0) continue
    const rows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const statsMap = aggregatePlayerStats(rows, displayNameByTeam, accountIdToPlayerId)
    const toInsert = [...statsMap.values()].map((e) => ({ ...e, stage_id: stage.id, updated_at: now }))
    if (toInsert.length > 0) await insertPlayerRows(db, 'stage_player_stats', toInsert as AnyRow[])
  }

  // ── 2. Series player stats ────────────────────────────────────────
  for (const sr of seriesList) {
    const srStages = stages.filter((s) => s.series_id === sr.id)
    const matchIds = srStages.flatMap((s) => matchIdsByStage.get(s.id as string) ?? [])
    if (matchIds.length === 0) continue
    const rows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const statsMap = aggregatePlayerStats(rows, displayNameByTeam, accountIdToPlayerId)
    const toInsert = [...statsMap.values()].map((e) => ({ ...e, series_id: sr.id, updated_at: now }))
    if (toInsert.length > 0) await insertPlayerRows(db, 'series_player_stats', toInsert as AnyRow[])
  }

  // ── 3. Tournament team stats (total matches only) ─────────────────
  const teamStatsMap = new Map<string, {
    team_id: string | null; team_name: string; logo_url: string | null
    games: number; wwcd: number; total_kills: number; total_damage: number
  }>()
  for (const r of trData) {
    const key = (r.team_id ?? r.pubg_team_name ?? '?') as string
    const ex = teamStatsMap.get(key) ?? {
      team_id: (r.team_id ?? null) as string | null,
      team_name: (r.team_id ? (displayNameByTeam.get(r.team_id as string) ?? null) : null) ??
        (r.teams as AnyRow | null)?.name ?? (r.pubg_team_name as string) ?? '?',
      logo_url: ((r.teams as AnyRow | null)?.logo_url ?? null) as string | null,
      games: 0, wwcd: 0, total_kills: 0, total_damage: 0,
    }
    ex.games++
    if ((r.placement as number) === 1) ex.wwcd++
    ex.total_kills += (r.total_kills as number) ?? 0
    ex.total_damage += Number(r.total_damage ?? 0)
    teamStatsMap.set(key, ex)
  }

  // ── 4. Tournament player stats (total matches only) ───────────────
  const totalPsData = totalMatchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
  const playerStatsMap = aggregatePlayerStats(totalPsData, displayNameByTeam, accountIdToPlayerId)

  const teamRows = [...teamStatsMap.values()].map((e) => ({ ...e, tournament_id: tournamentId, updated_at: now }))
  const playerRows = [...playerStatsMap.values()].map((e) => ({ ...e, tournament_id: tournamentId, updated_at: now }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let off = 0; off < teamRows.length; off += BATCH) {
    const { error } = await db.from('tournament_team_stats').insert(teamRows.slice(off, off + BATCH) as any)
    if (error) console.error('[compute-stats] tournament_team_stats insert failed:', error.message)
  }
  await insertPlayerRows(db, 'tournament_player_stats', playerRows as AnyRow[])
}
