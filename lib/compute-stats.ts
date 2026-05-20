import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { ruleFromStage, calcPlacementPtsWithRule } from './scoring'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof createSupabaseClient<any, any, any>>

const PAGE = 1000
const ID_CHUNK = 80
const BATCH = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

// build() is called fresh on every page so the query object is never reused
// across iterations — some versions of the Supabase JS client are mutable and
// accumulate extra .order()/.range() clauses when the same instance is chained
// multiple times.
async function fetchPaged<T>(build: () => any, orderCol = 'id'): Promise<T[]> {
  const rows: T[] = []
  let page = 0
  while (true) {
    const { data: batch, error } = await build().order(orderCol).range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`DB fetch failed: ${(error as { message?: string }).message ?? String(error)}`)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as T[]))
    if (batch.length < PAGE) break
    page++
  }
  return rows
}

async function fetchInChunked<T>(build: (chunk: string[]) => any, ids: string[], orderCol = 'id'): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let off = 0; off < ids.length; off += ID_CHUNK) chunks.push(ids.slice(off, off + ID_CHUNK))
  const out = await Promise.all(chunks.map((c) => fetchPaged<T>(() => build(c), orderCol)))
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
  walk_distance: number
  ride_distance: number
  longest_kill: number
  swim_distance: number
  revives: number
  heals_used: number
  boosts_used: number
  road_kills: number
  vehicle_destroys: number
  team_kills: number
  // Telemetry-derived (combat)
  deaths: number
  damage_taken: number
  blue_zone_damage: number
  knock_damage_sum: number
  engagement_dist_sum: number
  engagement_dist_count: number
  first_blood_kills: number
  first_blood_knocks: number
  // Telemetry-derived (utility)
  grenades_thrown: number
  smokes_thrown: number
  flashbangs_thrown: number
  molotovs_thrown: number
  grenade_damage: number
  molotov_damage: number
  grenade_hit_events: number
  // Telemetry-derived (survival)
  total_heal_amount: number
  blue_zone_time: number
  // Telemetry-derived (movement)
  vehicle_time: number
  // Telemetry-derived (teamplay)
  revives_given: number
  assist_damage: number
  trade_kills: number
  tradeable_deaths: number
  // Telemetry-derived (positioning)
  zone_edge_samples: number
  zone_total_samples: number
  zone_outside_samples: number
  zone_dist_sum: number
}

interface TeamStatsExtEntry {
  team_id: string | null
  team_name: string
  logo_url: string | null
  games: number
  wwcd: number
  kills: number
  assists: number
  knocks: number
  headshot_kills: number
  damage: number
  survival_time: number
  deaths: number
  longest_kill: number
  knock_damage_sum: number
  engagement_dist_sum: number
  engagement_dist_count: number
  first_blood_kills: number
  first_blood_knocks: number
  grenades_thrown: number
  smokes_thrown: number
  flashbangs_thrown: number
  molotovs_thrown: number
  grenade_damage: number
  molotov_damage: number
  grenade_hit_events: number
  damage_taken: number
  blue_zone_damage: number
  heals_used: number
  boosts_used: number
  total_heal_amount: number
  revives: number
  blue_zone_time: number
  walk_distance: number
  ride_distance: number
  swim_distance: number
  vehicle_time: number
  revives_given: number
  assist_damage: number
  trade_kills: number
  tradeable_deaths: number
  zone_edge_samples: number
  zone_total_samples: number
  zone_outside_samples: number
  zone_dist_sum: number
  player_entries: number
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
      walk_distance: 0, ride_distance: 0, longest_kill: 0, swim_distance: 0,
      revives: 0, heals_used: 0, boosts_used: 0, road_kills: 0, vehicle_destroys: 0, team_kills: 0,
      deaths: 0, damage_taken: 0, blue_zone_damage: 0,
      knock_damage_sum: 0, engagement_dist_sum: 0, engagement_dist_count: 0,
      first_blood_kills: 0, first_blood_knocks: 0,
      grenades_thrown: 0, smokes_thrown: 0, flashbangs_thrown: 0, molotovs_thrown: 0,
      grenade_damage: 0, molotov_damage: 0, grenade_hit_events: 0,
      total_heal_amount: 0, blue_zone_time: 0,
      vehicle_time: 0,
      revives_given: 0, assist_damage: 0, trade_kills: 0, tradeable_deaths: 0,
      zone_edge_samples: 0, zone_total_samples: 0, zone_outside_samples: 0, zone_dist_sum: 0,
    }
    ex.games++
    ex.kills += (d.kills as number) ?? 0
    ex.assists += (d.assists as number) ?? 0
    ex.knocks += (d.knocks as number) ?? 0
    ex.headshot_kills += (d.headshot_kills as number) ?? 0
    ex.damage += Number(d.damage_dealt ?? 0)
    ex.survival_time += Number(d.survival_time ?? 0)
    ex.walk_distance += Number(d.walk_distance ?? 0)
    ex.ride_distance += Number(d.ride_distance ?? 0)
    ex.longest_kill = Math.max(ex.longest_kill, Number(d.longest_kill ?? 0))
    ex.swim_distance += Number(d.swim_distance ?? 0)
    ex.revives += (d.revives as number) ?? 0
    ex.heals_used += (d.heals_used as number) ?? 0
    ex.boosts_used += (d.boosts_used as number) ?? 0
    ex.road_kills += (d.road_kills as number) ?? 0
    ex.vehicle_destroys += (d.vehicle_destroys as number) ?? 0
    ex.team_kills += (d.team_kills as number) ?? 0
    ex.deaths += (d.deaths as number) ?? 0
    ex.damage_taken += Number(d.damage_taken ?? 0)
    ex.blue_zone_damage += Number(d.blue_zone_damage ?? 0)
    ex.knock_damage_sum += Number(d.knock_damage_sum ?? 0)
    ex.engagement_dist_sum += Number(d.engagement_dist_sum ?? 0)
    ex.engagement_dist_count += (d.engagement_dist_count as number) ?? 0
    ex.first_blood_kills += (d.first_blood_kill ? 1 : 0)
    ex.first_blood_knocks += (d.first_blood_knock ? 1 : 0)
    ex.grenades_thrown += (d.grenades_thrown as number) ?? 0
    ex.smokes_thrown += (d.smokes_thrown as number) ?? 0
    ex.flashbangs_thrown += (d.flashbangs_thrown as number) ?? 0
    ex.molotovs_thrown += (d.molotovs_thrown as number) ?? 0
    ex.grenade_damage += Number(d.grenade_damage ?? 0)
    ex.molotov_damage += Number(d.molotov_damage ?? 0)
    ex.grenade_hit_events += (d.grenade_hit_events as number) ?? 0
    ex.total_heal_amount += Number(d.total_heal_amount ?? 0)
    ex.blue_zone_time += (d.blue_zone_time as number) ?? 0
    ex.vehicle_time += (d.vehicle_time as number) ?? 0
    ex.revives_given += (d.revives_given as number) ?? 0
    ex.assist_damage += Number(d.assist_damage ?? 0)
    ex.trade_kills += (d.trade_kills as number) ?? 0
    ex.tradeable_deaths += (d.tradeable_deaths as number) ?? 0
    ex.zone_edge_samples += (d.zone_edge_samples as number) ?? 0
    ex.zone_total_samples += (d.zone_total_samples as number) ?? 0
    ex.zone_outside_samples += (d.zone_outside_samples as number) ?? 0
    ex.zone_dist_sum += Number(d.zone_dist_sum ?? 0)
    map.set(key, ex)
  }
  return map
}

function buildTeamExtMap(
  playerRows: AnyRow[],
  teamResultRows: AnyRow[],
  displayNameByTeam: Map<string, string>,
): Map<string, TeamStatsExtEntry> {
  const map = new Map<string, TeamStatsExtEntry>()
  for (const d of playerRows) {
    const key = (d.team_id ?? null) as string | null
    if (!key) continue
    if (!map.has(key)) {
      const teamName = displayNameByTeam.get(key) ?? ((d.teams as AnyRow | null)?.name ?? key) as string
      map.set(key, {
        team_id: key, team_name: teamName,
        logo_url: ((d.teams as AnyRow | null)?.logo_url ?? null) as string | null,
        games: 0, wwcd: 0,
        kills: 0, assists: 0, knocks: 0, headshot_kills: 0, damage: 0, survival_time: 0,
        deaths: 0, longest_kill: 0,
        knock_damage_sum: 0, engagement_dist_sum: 0, engagement_dist_count: 0,
        first_blood_kills: 0, first_blood_knocks: 0,
        grenades_thrown: 0, smokes_thrown: 0, flashbangs_thrown: 0, molotovs_thrown: 0,
        grenade_damage: 0, molotov_damage: 0, grenade_hit_events: 0,
        damage_taken: 0, blue_zone_damage: 0,
        heals_used: 0, boosts_used: 0, total_heal_amount: 0, revives: 0, blue_zone_time: 0,
        walk_distance: 0, ride_distance: 0, swim_distance: 0, vehicle_time: 0,
        revives_given: 0, assist_damage: 0, trade_kills: 0, tradeable_deaths: 0,
        zone_edge_samples: 0, zone_total_samples: 0, zone_outside_samples: 0, zone_dist_sum: 0,
        player_entries: 0,
      })
    }
    const e = map.get(key)!
    e.player_entries++
    e.kills += (d.kills as number) ?? 0
    e.assists += (d.assists as number) ?? 0
    e.knocks += (d.knocks as number) ?? 0
    e.headshot_kills += (d.headshot_kills as number) ?? 0
    e.damage += Number(d.damage_dealt ?? 0)
    e.survival_time += Number(d.survival_time ?? 0)
    e.longest_kill = Math.max(e.longest_kill, Number(d.longest_kill ?? 0))
    e.deaths += (d.deaths as number) ?? 0
    e.knock_damage_sum += Number(d.knock_damage_sum ?? 0)
    e.engagement_dist_sum += Number(d.engagement_dist_sum ?? 0)
    e.engagement_dist_count += (d.engagement_dist_count as number) ?? 0
    e.first_blood_kills += (d.first_blood_kill ? 1 : 0)
    e.first_blood_knocks += (d.first_blood_knock ? 1 : 0)
    e.grenades_thrown += (d.grenades_thrown as number) ?? 0
    e.smokes_thrown += (d.smokes_thrown as number) ?? 0
    e.flashbangs_thrown += (d.flashbangs_thrown as number) ?? 0
    e.molotovs_thrown += (d.molotovs_thrown as number) ?? 0
    e.grenade_damage += Number(d.grenade_damage ?? 0)
    e.molotov_damage += Number(d.molotov_damage ?? 0)
    e.grenade_hit_events += (d.grenade_hit_events as number) ?? 0
    e.damage_taken += Number(d.damage_taken ?? 0)
    e.blue_zone_damage += Number(d.blue_zone_damage ?? 0)
    e.heals_used += (d.heals_used as number) ?? 0
    e.boosts_used += (d.boosts_used as number) ?? 0
    e.total_heal_amount += Number(d.total_heal_amount ?? 0)
    e.revives += (d.revives as number) ?? 0
    e.blue_zone_time += (d.blue_zone_time as number) ?? 0
    e.walk_distance += Number(d.walk_distance ?? 0)
    e.ride_distance += Number(d.ride_distance ?? 0)
    e.swim_distance += Number(d.swim_distance ?? 0)
    e.vehicle_time += (d.vehicle_time as number) ?? 0
    e.revives_given += (d.revives_given as number) ?? 0
    e.assist_damage += Number(d.assist_damage ?? 0)
    e.trade_kills += (d.trade_kills as number) ?? 0
    e.tradeable_deaths += (d.tradeable_deaths as number) ?? 0
    e.zone_edge_samples += (d.zone_edge_samples as number) ?? 0
    e.zone_total_samples += (d.zone_total_samples as number) ?? 0
    e.zone_outside_samples += (d.zone_outside_samples as number) ?? 0
    e.zone_dist_sum += Number(d.zone_dist_sum ?? 0)
  }
  for (const r of teamResultRows) {
    const key = (r.team_id ?? null) as string | null
    if (!key || !map.has(key)) continue
    const e = map.get(key)!
    e.games++
    if ((r.placement as number) === 1) e.wwcd++
  }
  return map
}

async function insertPlayerRows(db: DB, table: string, rows: AnyRow[]): Promise<void> {
  for (let off = 0; off < rows.length; off += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from(table).insert(rows.slice(off, off + BATCH) as any)
    if (error) throw new Error(`[compute-stats] ${table} insert failed: ${error.message}`)
  }
}

export async function computeTournamentStats(tournamentId: string, db: DB): Promise<void> {
  // Fetch stages (all, not just total — stage stats cover every stage)
  const { data: stagesData } = await db
    .from('stages')
    .select('id, series_id, type, order_num, include_in_total, scoring_rules(*)')
    .eq('tournament_id', tournamentId)
    .order('order_num')
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
    stageIds.length > 0
      ? db.from('stage_team_stats').delete().in('stage_id', stageIds)
      : Promise.resolve(),
    seriesIds.length > 0
      ? db.from('series_team_stats').delete().in('series_id', seriesIds)
      : Promise.resolve(),
    db.from('tournament_team_stats').delete().eq('tournament_id', tournamentId),
    db.from('tournament_player_stats').delete().eq('tournament_id', tournamentId),
    db.from('tournament_final_standings').delete().eq('tournament_id', tournamentId),
    db.from('kill_club_100').delete().eq('tournament_id', tournamentId),
  ])

  if (stageIds.length === 0) return

  // Fetch ALL imported matches (including excluded-from-total stages, needed for stage stats)
  const allMatches = await fetchInChunked<AnyRow>(
    (chunk) => db.from('matches').select('id, stage_id, status, order_num').in('stage_id', chunk),
    stageIds,
  )

  // Group match IDs by stage, sorted by order_num for tiebreaker consistency
  const matchesByStageRaw = new Map<string, AnyRow[]>()
  for (const m of allMatches) {
    if (m.status !== 'imported') continue
    const sid = m.stage_id as string
    if (!matchesByStageRaw.has(sid)) matchesByStageRaw.set(sid, [])
    matchesByStageRaw.get(sid)!.push(m)
  }
  const matchIdsByStage = new Map<string, string[]>()
  for (const [sid, ms] of matchesByStageRaw.entries()) {
    matchIdsByStage.set(sid, ms.sort((a, b) => (a.order_num as number) - (b.order_num as number)).map((m) => m.id as string))
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
  const PS_SELECT = 'match_id, player_id, team_id, pubg_account_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, walk_distance, ride_distance, longest_kill, swim_distance, revives, heals_used, boosts_used, road_kills, vehicle_destroys, team_kills, players(id, nickname), teams(id, name, logo_url)'

  const [allTrData, allPsData, allTelData] = await Promise.all([
    // Fetch team results for ALL imported matches (needed for stage standings + final standings)
    allImportedMatchIds.length > 0
      ? fetchInChunked<AnyRow>(
          (chunk) =>
            db
              .from('match_team_results')
              .select('match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
              .in('match_id', chunk),
          allImportedMatchIds,
        )
      : Promise.resolve([]),
    fetchInChunked<AnyRow>(
      (chunk) => db.from('match_player_stats').select(PS_SELECT).in('match_id', chunk),
      allImportedMatchIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => db.from('match_player_telemetry_stats').select('match_id, pubg_account_id, deaths, damage_taken, blue_zone_damage, knock_damage_sum, engagement_dist_sum, engagement_dist_count, first_blood_kill, first_blood_knock, grenades_thrown, smokes_thrown, flashbangs_thrown, molotovs_thrown, grenade_damage, molotov_damage, grenade_hit_events, heals_used, boosts_used, total_heal_amount, blue_zone_time, vehicle_time, revives_given, assist_damage, trade_kills, tradeable_deaths, zone_edge_samples, zone_total_samples, zone_outside_samples, zone_dist_sum').in('match_id', chunk),
      allImportedMatchIds,
      'match_id',
    ),
  ])
  // Tournament-team-stats only use total matches (exclude stages with include_in_total === false)
  const totalMatchIdSet = new Set(totalMatchIds)
  const trData = allTrData.filter((r) => totalMatchIdSet.has(r.match_id as string))

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

  // Merge telemetry stats into match_player_stats rows keyed by (match_id, pubg_account_id)
  const telByMatchAccount = new Map<string, AnyRow>()
  for (const t of allTelData) {
    telByMatchAccount.set(`${t.match_id as string}:${t.pubg_account_id as string}`, t)
  }
  // Attach telemetry fields to the PS rows so aggregatePlayerStats sees them
  for (const d of allPsData) {
    const tel = telByMatchAccount.get(`${d.match_id as string}:${d.pubg_account_id as string}`)
    if (tel) {
      d.deaths = tel.deaths
      d.damage_taken = tel.damage_taken
      d.blue_zone_damage = tel.blue_zone_damage
      d.knock_damage_sum = tel.knock_damage_sum
      d.engagement_dist_sum = tel.engagement_dist_sum
      d.engagement_dist_count = tel.engagement_dist_count
      d.first_blood_kill = tel.first_blood_kill
      d.first_blood_knock = tel.first_blood_knock
      d.grenades_thrown = tel.grenades_thrown
      d.smokes_thrown = tel.smokes_thrown
      d.flashbangs_thrown = tel.flashbangs_thrown
      d.molotovs_thrown = tel.molotovs_thrown
      d.grenade_damage = tel.grenade_damage
      d.molotov_damage = tel.molotov_damage
      d.grenade_hit_events = tel.grenade_hit_events
      d.heals_used = tel.heals_used
      d.boosts_used = tel.boosts_used
      d.total_heal_amount = tel.total_heal_amount
      d.blue_zone_time = tel.blue_zone_time
      d.vehicle_time = tel.vehicle_time
      d.revives_given = tel.revives_given
      d.assist_damage = tel.assist_damage
      d.trade_kills = tel.trade_kills
      d.tradeable_deaths = tel.tradeable_deaths
      d.zone_edge_samples = tel.zone_edge_samples
      d.zone_total_samples = tel.zone_total_samples
      d.zone_outside_samples = tel.zone_outside_samples
      d.zone_dist_sum = tel.zone_dist_sum
    }
  }

  const now = new Date().toISOString()

  // ── 1. Stage player stats ─────────────────────────────────────────
  await Promise.all(stages.map((stage) => {
    const matchIds = matchIdsByStage.get(stage.id as string) ?? []
    if (matchIds.length === 0) return Promise.resolve()
    const rows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const statsMap = aggregatePlayerStats(rows, displayNameByTeam, accountIdToPlayerId)
    const toInsert = [...statsMap.values()].map((e) => ({ ...e, stage_id: stage.id, updated_at: now }))
    return toInsert.length > 0 ? insertPlayerRows(db, 'stage_player_stats', toInsert as AnyRow[]) : Promise.resolve()
  }))

  // ── 1b. Stage team stats ──────────────────────────────────────────
  await Promise.all(stages.map((stage) => {
    const matchIds = matchIdsByStage.get(stage.id as string) ?? []
    if (matchIds.length === 0) return Promise.resolve()
    const matchIdSet = new Set(matchIds)
    const psRows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const trRows = allTrData.filter((r) => matchIdSet.has(r.match_id as string))
    const teamExtStage = buildTeamExtMap(psRows, trRows, displayNameByTeam)
    const toInsert = [...teamExtStage.values()].map((e) => ({ ...e, stage_id: stage.id, updated_at: now }))
    return toInsert.length > 0 ? insertPlayerRows(db, 'stage_team_stats', toInsert as AnyRow[]) : Promise.resolve()
  }))

  // ── 2. Series player stats ────────────────────────────────────────
  await Promise.all(seriesList.map((sr) => {
    const srStages = stages.filter((s) => s.series_id === sr.id)
    const matchIds = srStages.flatMap((s) => matchIdsByStage.get(s.id as string) ?? [])
    if (matchIds.length === 0) return Promise.resolve()
    const rows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const statsMap = aggregatePlayerStats(rows, displayNameByTeam, accountIdToPlayerId)
    const toInsert = [...statsMap.values()].map((e) => ({ ...e, series_id: sr.id, updated_at: now }))
    return toInsert.length > 0 ? insertPlayerRows(db, 'series_player_stats', toInsert as AnyRow[]) : Promise.resolve()
  }))

  // ── 2b. Series team stats ─────────────────────────────────────────
  await Promise.all(seriesList.map((sr) => {
    const srStages = stages.filter((s) => s.series_id === sr.id)
    const matchIds = srStages.flatMap((s) => matchIdsByStage.get(s.id as string) ?? [])
    if (matchIds.length === 0) return Promise.resolve()
    const matchIdSet = new Set(matchIds)
    const psRows = matchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
    const trRows = allTrData.filter((r) => matchIdSet.has(r.match_id as string))
    const teamExtSeries = buildTeamExtMap(psRows, trRows, displayNameByTeam)
    const toInsert = [...teamExtSeries.values()].map((e) => ({ ...e, series_id: sr.id, updated_at: now }))
    return toInsert.length > 0 ? insertPlayerRows(db, 'series_team_stats', toInsert as AnyRow[]) : Promise.resolve()
  }))

  // ── 3. Tournament team stats (total matches only) ─────────────────
  const totalPsData = totalMatchIds.flatMap((mid) => psByMatch.get(mid) ?? [])
  const teamExtMap = buildTeamExtMap(totalPsData, trData, displayNameByTeam)

  // ── 4. Tournament player stats (total matches only) ───────────────
  const playerStatsMap = aggregatePlayerStats(totalPsData, displayNameByTeam, accountIdToPlayerId)

  const teamRows = [...teamExtMap.values()].map((e) => ({
    ...e,
    total_kills: e.kills,
    total_damage: e.damage,
    tournament_id: tournamentId,
    updated_at: now,
  }))
  const playerRows = [...playerStatsMap.values()].map((e) => ({ ...e, tournament_id: tournamentId, updated_at: now }))

  // ── 5. 100킬 클럽 (tournament_player_stats에서 kills >= 100인 선수) ─────
  const killClubByNickname = new Map<string, AnyRow>()
  for (const r of playerRows) {
    if ((r.kills as number) < 100) continue
    const nick = (r.nickname as string).toLowerCase()
    const existing = killClubByNickname.get(nick)
    if (!existing || (r.kills as number) > (existing.kills as number)) {
      killClubByNickname.set(nick, {
        tournament_id: tournamentId,
        player_id: r.player_id ?? null,
        nickname: r.nickname,
        team_id: r.team_id ?? null,
        team_name: r.team_name,
        logo_url: r.logo_url ?? null,
        kills: r.kills,
        games: r.games,
        damage: r.damage,
        updated_at: now,
      })
    }
  }
  const killClubRows = [...killClubByNickname.values()]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function batchInsert(table: string, rows: any[]): Promise<void> {
    for (let off = 0; off < rows.length; off += BATCH) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await db.from(table).insert(rows.slice(off, off + BATCH) as any)
      if (error) throw new Error(`[compute-stats] ${table} insert failed: ${error.message}`)
    }
  }

  await Promise.all([
    batchInsert('tournament_team_stats', teamRows),
    insertPlayerRows(db, 'tournament_player_stats', playerRows as AnyRow[]),
    // UPSERT (not INSERT) so a failed prior DELETE does not leave stale rows
    // that cause a UNIQUE(tournament_id, nickname) conflict on re-insert
    (async () => {
      for (let off = 0; off < killClubRows.length; off += BATCH) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (db.from('kill_club_100') as any).upsert(
          killClubRows.slice(off, off + BATCH),
          { onConflict: 'tournament_id,nickname' },
        )
        if (error) throw new Error(`[compute-stats] kill_club_100 upsert failed: ${error.message}`)
      }
    })(),
  ])

  // ── 6. Final standings (replicates TournamentContent rankBoard logic) ─
  const resultsByMatchForStandings = new Map<string, AnyRow[]>()
  for (const r of allTrData) {
    const mid = r.match_id as string
    if (!resultsByMatchForStandings.has(mid)) resultsByMatchForStandings.set(mid, [])
    resultsByMatchForStandings.get(mid)!.push(r)
  }
  await buildAndSaveFinalStandings(tournamentId, db, stages, seriesList, matchIdsByStage, resultsByMatchForStandings, displayNameByTeam, now)
}

async function buildAndSaveFinalStandings(
  tournamentId: string,
  db: DB,
  stages: AnyRow[],
  seriesList: AnyRow[],
  matchIdsByStage: Map<string, string[]>,
  resultsByMatch: Map<string, AnyRow[]>,
  displayNameByTeam: Map<string, string>,
  now: string,
): Promise<void> {
  const stageIds = stages.map((s) => s.id as string)
  const seriesIds = seriesList.map((s) => s.id as string)

  const [
    { data: tournamentData },
    { data: prizeConfigData },
    { data: additionalPtsData },
    { data: combinedData },
    { data: combinedStageData },
  ] = await Promise.all([
    db.from('tournaments').select('ranking_method').eq('id', tournamentId).single(),
    db.from('tournament_prize_config').select('rank, stage_rank, stage_id, series_id, combined_scoreboard_id').eq('tournament_id', tournamentId),
    stageIds.length > 0
      ? db.from('stage_additional_points').select('stage_id, team_id, team_name, points').in('stage_id', stageIds)
      : Promise.resolve({ data: [] }),
    db.from('combined_scoreboards').select('id, scoring_rules(*)').eq('tournament_id', tournamentId),
    stageIds.length > 0
      ? db.from('combined_scoreboard_stages').select('combined_scoreboard_id, stage_id').in('stage_id', stageIds)
      : Promise.resolve({ data: [] }),
  ])

  const rankingMethod = (tournamentData?.ranking_method ?? 'stage') as string

  const stageAdditionalPts: Record<string, Record<string, number>> = {}
  for (const ap of (additionalPtsData ?? []) as AnyRow[]) {
    if (!stageAdditionalPts[ap.stage_id]) stageAdditionalPts[ap.stage_id] = {}
    if (ap.team_id) stageAdditionalPts[ap.stage_id][ap.team_id as string] = Number(ap.points)
    stageAdditionalPts[ap.stage_id][(ap.team_name as string).toLowerCase()] = Number(ap.points)
  }

  const combinedStagesByCombined = new Map<string, Set<string>>()
  for (const r of (combinedStageData ?? []) as AnyRow[]) {
    const cid = r.combined_scoreboard_id as string
    if (!combinedStagesByCombined.has(cid)) combinedStagesByCombined.set(cid, new Set())
    combinedStagesByCombined.get(cid)!.add(r.stage_id as string)
  }

  const combinedRuleById = new Map<string, ReturnType<typeof ruleFromStage> | null>()
  for (const c of (combinedData ?? []) as AnyRow[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combinedRuleById.set(c.id as string, c.scoring_rules ? ruleFromStage(c.scoring_rules as any) : null)
  }

  const excludedStageIds = new Set(stages.filter((s) => s.include_in_total === false).map((s) => s.id as string))

  function resolveTeamName(r: AnyRow): string {
    const teamId = r.team_id as string | null
    if (teamId) {
      const dn = displayNameByTeam.get(teamId)
      if (dn) return dn
    }
    return ((r.teams as AnyRow | null)?.name ?? (r.pubg_team_name as string)) ?? '?'
  }

  type StandingEntry = {
    key: string
    teamId: string | null; teamName: string; logoUrl: string | null
    totalPts: number; placePts: number; killPts: number; wwcd: number
    lastMatchKills: number; lastMatchPlacement: number
  }

  function buildStandings(stageList: AnyRow[], overrideRule: ReturnType<typeof ruleFromStage> | null = null): StandingEntry[] {
    const ptsMap = new Map<string, StandingEntry>()
    // Determine last match across all stages for smash winner tracking
    const allMatchIds = stageList.flatMap(s => matchIdsByStage.get(s.id as string) ?? [])
    const overallLastMatchId = allMatchIds[allMatchIds.length - 1] ?? null
    for (const stage of stageList) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = overrideRule ?? ruleFromStage(stage.scoring_rules as any)
      const matchIds = matchIdsByStage.get(stage.id as string) ?? []
      const lastMatchId = matchIds[matchIds.length - 1] ?? null
      for (const mid of matchIds) {
        for (const r of resultsByMatch.get(mid) ?? []) {
          const key = (r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`) as string
          if (!ptsMap.has(key)) {
            ptsMap.set(key, {
              key,
              teamId: r.team_id ?? null, teamName: resolveTeamName(r),
              logoUrl: ((r.teams as AnyRow | null)?.logo_url ?? null) as string | null,
              totalPts: 0, placePts: 0, killPts: 0, wwcd: 0, lastMatchKills: 0, lastMatchPlacement: 99,
            })
          }
          const e = ptsMap.get(key)!
          const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
          const kp = Math.round((r.total_kills ?? 0) * rule.kill_pts)
          e.placePts += pp; e.killPts += kp; e.totalPts += pp + kp
          if (r.placement === 1) e.wwcd++
          if (mid === lastMatchId) { e.lastMatchKills = r.total_kills ?? 0; e.lastMatchPlacement = r.placement ?? 99 }
        }
      }
      const extra = stageAdditionalPts[stage.id as string] ?? {}
      for (const e of ptsMap.values()) {
        e.totalPts += (e.teamId ? extra[e.teamId] : undefined) ?? extra[e.teamName.toLowerCase()] ?? 0
      }
    }
    return [...ptsMap.values()]
  }

  function smashWinnerKey(stageList: AnyRow[]): string | null {
    const allMatchIds = stageList.flatMap(s => matchIdsByStage.get(s.id as string) ?? [])
    const lastMatchId = allMatchIds[allMatchIds.length - 1] ?? null
    if (!lastMatchId) return null
    const winner = (resultsByMatch.get(lastMatchId) ?? []).find(r => r.placement === 1)
    return winner ? (winner.team_id ?? `pubg:${winner.pubg_team_name ?? ''}`) as string : null
  }

  function sortBySubType(entries: StandingEntry[], subType: string): StandingEntry[] {
    if (subType === 'chicken_v2') {
      return entries.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (b.killPts !== a.killPts) return b.killPts - a.killPts
        if (b.lastMatchKills !== a.lastMatchKills) return b.lastMatchKills - a.lastMatchKills
        return a.lastMatchPlacement - b.lastMatchPlacement
      })
    }
    if (subType === 'chicken') {
      return entries.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
        return b.placePts - a.placePts
      })
    }
    if (subType === 'super_v1') {
      return entries.sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.killPts !== a.killPts ? b.killPts - a.killPts : b.placePts - a.placePts)
    }
    return entries.sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
  }

  function sortStandings(entries: StandingEntry[], ruleType: string, smashSubType?: string | null, smashWinnerKey?: string | null): StandingEntry[] {
    if (ruleType === 'smash') {
      const winnerIdx = smashWinnerKey ? entries.findIndex(e => e.key === smashWinnerKey) : -1
      if (winnerIdx >= 0) {
        const winner = entries[winnerIdx]
        const rest = entries.filter((_, i) => i !== winnerIdx)
        return [winner, ...sortBySubType(rest, smashSubType ?? 'super')]
      }
      return sortBySubType(entries, smashSubType ?? 'super')
    }
    return sortBySubType(entries, ruleType)
  }

  // Build stage standings (exclude stages with include_in_total === false)
  const stageStandingsMap = new Map<string, StandingEntry[]>()
  for (const stage of stages) {
    if (excludedStageIds.has(stage.id as string)) continue
    if ((matchIdsByStage.get(stage.id as string) ?? []).length === 0) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule = ruleFromStage(stage.scoring_rules as any)
    const wk = rule.type === 'smash' ? smashWinnerKey([stage]) : null
    stageStandingsMap.set(stage.id as string, sortStandings(buildStandings([stage]), rule.type ?? 'super', rule.smash_sub_type, wk))
  }

  // Build series standings
  const seriesStandingsMap = new Map<string, StandingEntry[]>()
  for (const sr of seriesList) {
    const srStages = stages.filter((s) => s.series_id === sr.id && !excludedStageIds.has(s.id as string))
    if (srStages.length === 0) continue
    seriesStandingsMap.set(sr.id as string, sortStandings(buildStandings(srStages), 'super'))
  }

  // Build combined standings
  const combinedStandingsMap = new Map<string, StandingEntry[]>()
  for (const c of (combinedData ?? []) as AnyRow[]) {
    const cid = c.id as string
    const cStageIds = combinedStagesByCombined.get(cid) ?? new Set()
    if (cStageIds.size === 0) continue
    const cbRule = combinedRuleById.get(cid) ?? null
    const cbStages = stages.filter((s) => cStageIds.has(s.id as string))
    const entries = buildStandings(cbStages, cbRule)
    const wk = cbRule?.type === 'smash' ? smashWinnerKey(cbStages) : null
    combinedStandingsMap.set(cid, sortStandings(entries, cbRule?.type ?? 'super', cbRule?.smash_sub_type, wk))
  }

  // Build rankBoard (mirrors TournamentContent rankBoard logic)
  const prizeConfig = (prizeConfigData ?? []) as AnyRow[]
  const rankBoard: Array<{ rank: number; team_id: string | null; team_name: string; logo_url: string | null }> = []

  if (rankingMethod === 'stage') {
    const hasMapping = prizeConfig.some((p) => (p.stage_id != null || p.series_id != null || p.combined_scoreboard_id != null) && p.stage_rank != null)
    if (hasMapping) {
      for (const pc of prizeConfig) {
        if (!pc.stage_rank) continue
        const standings = pc.combined_scoreboard_id
          ? (combinedStandingsMap.get(pc.combined_scoreboard_id as string) ?? [])
          : pc.series_id
          ? (seriesStandingsMap.get(pc.series_id as string) ?? [])
          : pc.stage_id
          ? (stageStandingsMap.get(pc.stage_id as string) ?? [])
          : []
        if (standings.length === 0) continue
        const entry = standings[(pc.stage_rank as number) - 1]
        if (entry) rankBoard.push({ rank: pc.rank as number, team_id: entry.teamId, team_name: entry.teamName, logo_url: entry.logoUrl })
      }
      rankBoard.sort((a, b) => a.rank - b.rank)
    } else {
      const grandFinal = stages.find((s) => s.type === 'grand_final' && !excludedStageIds.has(s.id as string))
      if (grandFinal) {
        const standings = stageStandingsMap.get(grandFinal.id as string) ?? []
        standings.forEach((e, i) => rankBoard.push({ rank: i + 1, team_id: e.teamId, team_name: e.teamName, logo_url: e.logoUrl }))
      }
    }
  } else {
    // prize / pgs / pgc ranking — build wwcdBonusByTeamId from rewards + stage/series prizes + special awards
    const [{ data: wwcdRewardsData }, { data: stagePrizeData }, { data: seriesPrizeData }, { data: specialAwardsData }] = await Promise.all([
      db.from('tournament_wwcd_rewards').select('stage_id, series_id, prize, pgs_points, pgc_points').eq('tournament_id', tournamentId),
      stageIds.length > 0
        ? db.from('stage_prize_config').select('stage_id, placement, prize, pgs_points, pgc_points').in('stage_id', stageIds)
        : Promise.resolve({ data: [] }),
      seriesIds.length > 0
        ? db.from('stage_prize_config').select('series_id, placement, prize, pgs_points, pgc_points').in('series_id', seriesIds)
        : Promise.resolve({ data: [] }),
      db.from('tournament_special_awards').select('team_id, prize, pgs_points, pgc_points').eq('tournament_id', tournamentId),
    ])

    const wwcdBonus: Record<string, { prize: number; pgs: number; pgc: number }> = {}
    function bump(tid: string, prize: number, pgs: number, pgc: number) {
      if (!wwcdBonus[tid]) wwcdBonus[tid] = { prize: 0, pgs: 0, pgc: 0 }
      wwcdBonus[tid].prize += prize; wwcdBonus[tid].pgs += pgs; wwcdBonus[tid].pgc += pgc
    }

    for (const stage of stages) {
      if (excludedStageIds.has(stage.id as string)) continue
      for (const mid of matchIdsByStage.get(stage.id as string) ?? []) {
        for (const r of resultsByMatch.get(mid) ?? []) {
          if (r.placement !== 1 || !r.team_id) continue
          for (const rw of (wwcdRewardsData ?? []) as AnyRow[]) {
            if (rw.stage_id && rw.stage_id !== stage.id) continue
            if (rw.series_id && rw.series_id !== stage.series_id) continue
            bump(r.team_id as string, rw.prize != null ? Number(rw.prize) : 0, rw.pgs_points != null ? Number(rw.pgs_points) : 0, rw.pgc_points != null ? Number(rw.pgc_points) : 0)
          }
        }
      }
    }

    const stagePrizeByStage: Record<string, AnyRow[]> = {}
    for (const row of (stagePrizeData ?? []) as AnyRow[]) {
      if (!stagePrizeByStage[row.stage_id]) stagePrizeByStage[row.stage_id] = []
      stagePrizeByStage[row.stage_id].push(row)
    }
    for (const stage of stages) {
      if (excludedStageIds.has(stage.id as string)) continue
      const prizes = stagePrizeByStage[stage.id as string]
      if (!prizes) continue
      const standings = stageStandingsMap.get(stage.id as string) ?? []
      for (let i = 0; i < standings.length; i++) {
        const e = standings[i]; if (!e.teamId) continue
        const pc = prizes.find((p) => p.placement === i + 1); if (!pc) continue
        bump(e.teamId, pc.prize != null ? Number(pc.prize) : 0, pc.pgs_points != null ? Number(pc.pgs_points) : 0, pc.pgc_points != null ? Number(pc.pgc_points) : 0)
      }
    }

    const seriesPrizeBySeriesId: Record<string, AnyRow[]> = {}
    for (const row of (seriesPrizeData ?? []) as AnyRow[]) {
      if (row.series_id) {
        if (!seriesPrizeBySeriesId[row.series_id]) seriesPrizeBySeriesId[row.series_id] = []
        seriesPrizeBySeriesId[row.series_id].push(row)
      }
    }
    for (const sr of seriesList) {
      const prizes = seriesPrizeBySeriesId[sr.id as string]
      if (!prizes) continue
      const standings = seriesStandingsMap.get(sr.id as string) ?? []
      for (let i = 0; i < standings.length; i++) {
        const e = standings[i]; if (!e.teamId) continue
        const pc = prizes.find((p) => p.placement === i + 1); if (!pc) continue
        bump(e.teamId, pc.prize != null ? Number(pc.prize) : 0, pc.pgs_points != null ? Number(pc.pgs_points) : 0, pc.pgc_points != null ? Number(pc.pgc_points) : 0)
      }
    }

    for (const r of (specialAwardsData ?? []) as AnyRow[]) {
      if (!r.team_id) continue
      bump(r.team_id as string, r.prize != null ? Number(r.prize) : 0, r.pgs_points != null ? Number(r.pgs_points) : 0, r.pgc_points != null ? Number(r.pgc_points) : 0)
    }

    const seen = new Set<string>()
    const teamList: { teamId: string | null; teamName: string; logoUrl: string | null; total: number }[] = []
    for (const standings of stageStandingsMap.values()) {
      for (const e of standings) {
        const key = e.teamId ?? `pubg:${e.teamName}`
        if (seen.has(key)) continue; seen.add(key)
        const bonus = e.teamId ? wwcdBonus[e.teamId] : undefined
        const total = bonus ? (rankingMethod === 'prize' ? bonus.prize : rankingMethod === 'pgs' ? bonus.pgs : bonus.pgc) : 0
        teamList.push({ teamId: e.teamId, teamName: e.teamName, logoUrl: e.logoUrl, total })
      }
    }
    teamList.sort((a, b) => b.total - a.total)
    teamList.forEach((e, i) => rankBoard.push({ rank: i + 1, team_id: e.teamId, team_name: e.teamName, logo_url: e.logoUrl }))
  }

  if (rankBoard.length === 0) return

  const rows = rankBoard.map((r) => ({ ...r, tournament_id: tournamentId, updated_at: now }))
  for (let off = 0; off < rows.length; off += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db.from('tournament_final_standings') as any).upsert(rows.slice(off, off + BATCH), { onConflict: 'tournament_id,rank' })
    if (error) console.error('[compute-stats] tournament_final_standings upsert failed:', error.message)
  }
}
