import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof createSupabaseClient<any, any, any>>

const PAGE = 1000
const ID_CHUNK = 80

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

export async function computeTournamentStats(tournamentId: string, db: DB): Promise<void> {
  // Fetch stages with include_in_total flag
  const { data: stagesData } = await db
    .from('stages')
    .select('id, include_in_total')
    .eq('tournament_id', tournamentId)
  const stages = (stagesData ?? []) as AnyRow[]
  const stageIds = stages.map((s) => s.id as string)

  if (stageIds.length === 0) {
    await db.from('tournament_team_stats').delete().eq('tournament_id', tournamentId)
    await db.from('tournament_player_stats').delete().eq('tournament_id', tournamentId)
    return
  }

  // Stages excluded from total stats
  const excludedStageIds = new Set(
    stages.filter((s) => s.include_in_total === false).map((s) => s.id as string),
  )

  // Fetch all matches for these stages
  const allMatches = await fetchInChunked<AnyRow>(
    (chunk) => db.from('matches').select('id, stage_id, status').in('stage_id', chunk),
    stageIds,
  )

  const importedMatchIds = allMatches
    .filter((m) => m.status === 'imported' && !excludedStageIds.has(m.stage_id as string))
    .map((m) => m.id as string)

  if (importedMatchIds.length === 0) {
    await db.from('tournament_team_stats').delete().eq('tournament_id', tournamentId)
    await db.from('tournament_player_stats').delete().eq('tournament_id', tournamentId)
    return
  }

  // Fetch display names for teams in this tournament
  const { data: ttData } = await db
    .from('tournament_teams')
    .select('team_id, display_name')
    .eq('tournament_id', tournamentId)
  const displayNameByTeam = new Map<string, string>()
  for (const tt of (ttData ?? []) as AnyRow[]) {
    if (tt.team_id && tt.display_name) displayNameByTeam.set(tt.team_id as string, tt.display_name as string)
  }

  const [trData, psData] = await Promise.all([
    fetchInChunked<AnyRow>(
      (chunk) =>
        db
          .from('match_team_results')
          .select('match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
          .in('match_id', chunk),
      importedMatchIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) =>
        db
          .from('match_player_stats')
          .select('match_id, player_id, pubg_account_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, players(id, nickname), teams(id, name, logo_url)')
          .in('match_id', chunk),
      importedMatchIds,
    ),
  ])

  // Compute team stats
  const teamStatsMap = new Map<string, {
    team_id: string | null; team_name: string; logo_url: string | null
    games: number; wwcd: number; total_kills: number; total_damage: number
  }>()
  for (const r of trData) {
    const key = (r.team_id ?? r.pubg_team_name ?? '?') as string
    const ex = teamStatsMap.get(key) ?? {
      team_id: (r.team_id ?? null) as string | null,
      team_name: (r.team_id ? (displayNameByTeam.get(r.team_id as string) ?? (r.teams as AnyRow | null)?.name) : null) ?? (r.pubg_team_name as string) ?? '?',
      logo_url: ((r.teams as AnyRow | null)?.logo_url ?? null) as string | null,
      games: 0, wwcd: 0, total_kills: 0, total_damage: 0,
    }
    ex.games++
    if ((r.placement as number) === 1) ex.wwcd++
    ex.total_kills += (r.total_kills as number) ?? 0
    ex.total_damage += Number(r.total_damage ?? 0)
    teamStatsMap.set(key, ex)
  }

  // account_id → player_id from any linked row (stable across renames/tag changes)
  const accountIdToPlayerId = new Map<string, string>()
  for (const d of psData) {
    if (d.player_id && d.pubg_account_id) {
      accountIdToPlayerId.set(d.pubg_account_id as string, d.player_id as string)
    }
  }

  // Compute player stats
  const playerStatsMap = new Map<string, {
    player_id: string | null; nickname: string
    team_id: string | null; team_name: string; logo_url: string | null
    games: number; kills: number; assists: number; knocks: number; headshot_kills: number; damage: number; survival_time: number
  }>()
  for (const d of psData) {
    // Resolve player_id via account_id if not directly linked
    let resolvedPlayerId = (d.player_id ?? null) as string | null
    if (!resolvedPlayerId && d.pubg_account_id) {
      resolvedPlayerId = accountIdToPlayerId.get(d.pubg_account_id as string) ?? null
    }

    const key = resolvedPlayerId ?? `pubg:${(d.pubg_player_name as string ?? '').toLowerCase()}`
    const teamName = (d.team_id ? (displayNameByTeam.get(d.team_id as string) ?? null) : null)
      ?? ((d.teams as AnyRow | null)?.name ?? '') as string
    const ex = playerStatsMap.get(key) ?? {
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
    playerStatsMap.set(key, ex)
  }

  const now = new Date().toISOString()
  const teamRows = [...teamStatsMap.values()].map((e) => ({ ...e, tournament_id: tournamentId, updated_at: now }))
  const playerRows = [...playerStatsMap.values()].map((e) => ({ ...e, tournament_id: tournamentId, updated_at: now }))

  // Replace existing rows for this tournament
  await db.from('tournament_team_stats').delete().eq('tournament_id', tournamentId)
  await db.from('tournament_player_stats').delete().eq('tournament_id', tournamentId)

  const BATCH = 500
  for (let off = 0; off < teamRows.length; off += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('tournament_team_stats').insert(teamRows.slice(off, off + BATCH) as any)
    if (error) console.error('[compute-stats] team insert failed:', error.message)
  }
  for (let off = 0; off < playerRows.length; off += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('tournament_player_stats').insert(playerRows.slice(off, off + BATCH) as any)
    if (error) console.error('[compute-stats] player insert failed:', error.message)
  }
}
