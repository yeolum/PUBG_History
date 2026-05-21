import { unstable_cache } from 'next/cache'
import { createPublicClient, createUncachedPublicClient, createServiceClient } from '@/lib/supabase/server'
import type { Tournament, Stage, Match, TournamentPrizeConfig, Series } from '@/lib/types'
import { calcPlacementPtsWithRule, ruleFromStage, getNameVariants } from '@/lib/scoring'
import { stripTagPrefix } from '@/lib/pubg-api'
import TournamentRoster from './TournamentRoster'
import TournamentDetailTabs from './TournamentDetailTabs'
import type { PlayerStatRow, PlayerMatchStat } from './PlayerStatsTable'
import type { TeamStatRow, DropLocationRow, TeamExtRow } from './TeamStatsTable'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const PS_SELECT = 'match_id, player_id, team_id, pubg_account_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, walk_distance, ride_distance, longest_kill, swim_distance, revives, heals_used, boosts_used, placement, players(id, nickname, nationality_code), teams(id, name, logo_url)'
const TR_SELECT = '*, teams(id, name, short_name, logo_url)'
const PAGE = 1000

// Paginates any pre-built Supabase query, returning { data: rows } to match
// the existing destructuring pattern. Handles PostgREST's 1000-row cap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T>(query: any, orderCol = 'id'): Promise<{ data: T[] }> {
  const rows: T[] = []
  let pg = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: batch } = await (query as any).order(orderCol).range(pg * PAGE, (pg + 1) * PAGE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as T[]))
    if (batch.length < PAGE) break
    pg++
  }
  return { data: rows }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(supabase: ReturnType<typeof createPublicClient>, table: string, select: string, matchIds: string[]): Promise<AnyRow[]> {
  // Chunk match_ids so the .in() list doesn't overflow PostgREST / proxy URL
  // limits on tournaments with lots of matches (multi-stage / multi-series).
  // Pages within a chunk must run sequentially (we don't know the total up
  // front); chunks themselves are independent so we run them in parallel for
  // big tournaments — this used to be the dominant load-time cost.
  const ID_CHUNK = 80
  const chunks: string[][] = []
  for (let off = 0; off < matchIds.length; off += ID_CHUNK) {
    chunks.push(matchIds.slice(off, off + ID_CHUNK))
  }
  const perChunk = await Promise.all(chunks.map(async (ids, ci) => {
    const out: AnyRow[] = []
    let page = 0
    while (true) {
      const { data: batch, error } = await supabase
        .from(table)
        .select(select)
        .in('match_id', ids)
        .order('id')
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) {
        console.error(`fetchAllPages(${table}) chunk ${ci} page ${page} failed:`, error.message)
        break
      }
      if (!batch || batch.length === 0) break
      out.push(...(batch as AnyRow[]))
      if (batch.length < PAGE) break
      page++
    }
    return out
  }))
  return perChunk.flat()
}

// Caches all heavy DB fetching in Node.js process memory (dev + prod).
// First load: hits DB. Subsequent loads within 30s: returns cached result instantly.
const loadTournamentData = unstable_cache(
  async (id: string) => {
    const supabase = createUncachedPublicClient()
    // stage_additional_points RLS blocks anon reads despite FOR SELECT USING (true),
    // so use service client for this table only.
    const svcSupabase = createServiceClient()

    const aliasQueriesPromise = Promise.all([
      fetchAllRows<AnyRow>(supabase.from('team_aliases').select('team_id, alias, logo_url')),
      supabase.from('team_drop_locations').select('id, team_id, map_name, x, y, teams(name, logo_url)').eq('tournament_id', id),
      fetchAllRows<AnyRow>(supabase.from('player_aliases').select('alias, player_id')),
    ])

    const [{ data: stagesData }, { data: prizeConfigData }, { data: seriesData }] = await Promise.all([
      // Matches are fetched separately and attached below — relying on the
      // embedded `matches(*)` would let PostgREST's row cap silently truncate
      // a big multi-stage tournament's match list, blanking the player data.
      supabase.from('stages').select('*, include_in_total, scoring_rules(*)').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, series_id, combined_scoreboard_id, stage_rank').eq('tournament_id', id).order('rank'),
      supabase.from('series').select('*, scoring_rules(*)').eq('tournament_id', id).order('order_num'),
    ])

    const stageIds = (stagesData ?? []).map((s: AnyRow) => s.id as string)
    const seriesIds = (seriesData ?? []).map((sr: AnyRow) => sr.id as string)

    // Kick off matches fetch + every non-matchId query in parallel. Matches
    // are needed before the trData / psData fetches start, so we only await
    // them here — the side queries keep running and are joined later.
    const matchesPromise = (async (): Promise<AnyRow[]> => {
      if (stageIds.length === 0) return []
      const STAGE_CHUNK = 80
      const chunks: string[][] = []
      for (let off = 0; off < stageIds.length; off += STAGE_CHUNK) {
        chunks.push(stageIds.slice(off, off + STAGE_CHUNK))
      }
      const perChunk = await Promise.all(chunks.map(async (chunk, ci) => {
        const out: AnyRow[] = []
        let mp = 0
        while (true) {
          const { data: batch, error } = await supabase
            .from('matches')
            .select('*')
            .in('stage_id', chunk)
            .order('id')
            .range(mp * PAGE, (mp + 1) * PAGE - 1)
          if (error) {
            console.error(`matches chunk ${ci} page ${mp} failed:`, error.message)
            break
          }
          if (!batch || batch.length === 0) break
          out.push(...(batch as AnyRow[]))
          if (batch.length < PAGE) break
          mp++
        }
        return out
      }))
      return perChunk.flat()
    })()

    // Side queries that don't depend on matchIds — start them now so they
    // run alongside the matches + trData + psData fetches.
    const EXTENDED_PLAYER_COLS = 'games, kills, assists, knocks, headshot_kills, damage, survival_time, walk_distance, ride_distance, longest_kill, swim_distance, revives, heals_used, boosts_used, road_kills, vehicle_destroys, team_kills, deaths, damage_taken, blue_zone_damage, knock_damage_sum, engagement_dist_sum, engagement_dist_count, first_blood_kills, first_blood_knocks, steal_kills, stolen_kills, grenades_thrown, smokes_thrown, flashbangs_thrown, molotovs_thrown, bz_grenades_thrown, decoy_grenades_thrown, grenade_damage, molotov_damage, bz_grenade_damage, grenade_hit_events, total_heal_amount, blue_zone_time, vehicle_time, revives_given, assist_damage, trade_kills, tradeable_deaths, zone_edge_samples, zone_total_samples, zone_outside_samples, zone_dist_sum'
    const EXTENDED_TEAM_COLS = 'games, wwcd, kills, assists, knocks, headshot_kills, damage, survival_time, deaths, longest_kill, knock_damage_sum, engagement_dist_sum, engagement_dist_count, steal_kills, stolen_kills, grenades_thrown, smokes_thrown, flashbangs_thrown, molotovs_thrown, bz_grenades_thrown, decoy_grenades_thrown, grenade_damage, molotov_damage, bz_grenade_damage, grenade_hit_events, damage_taken, blue_zone_damage, heals_used, boosts_used, total_heal_amount, revives, blue_zone_time, walk_distance, ride_distance, swim_distance, vehicle_time, revives_given, assist_damage, trade_kills, tradeable_deaths, zone_edge_samples, zone_total_samples, zone_outside_samples, zone_dist_sum, player_entries'
    const SPS_SELECT = `stage_id, player_id, nickname, team_id, team_name, logo_url, ${EXTENDED_PLAYER_COLS}`
    const SRPS_SELECT = `series_id, player_id, nickname, team_id, team_name, logo_url, ${EXTENDED_PLAYER_COLS}`
    const STS_SELECT = `stage_id, team_id, team_name, logo_url, ${EXTENDED_TEAM_COLS}`
    const SRTS_SELECT = `series_id, team_id, team_name, logo_url, ${EXTENDED_TEAM_COLS}`
    const sideQueriesPromise = Promise.all([
      aliasQueriesPromise,
      stageIds.length === 0 ? Promise.resolve({ data: [] }) : svcSupabase.from('stage_additional_points').select('id, stage_id, team_id, team_name, points').in('stage_id', stageIds),
      supabase.from('tournament_wwcd_rewards').select('*').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_special_awards').select('*, players(id, nickname), teams(id, name, logo_url)').eq('tournament_id', id).order('order_num'),
      stageIds.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('stage_prize_config').select('stage_id, placement, prize, pgs_points, pgc_points').in('stage_id', stageIds),
      seriesIds.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('stage_prize_config').select('series_id, placement, prize, pgs_points, pgc_points').in('series_id', seriesIds),
      fetchAllRows<AnyRow>(supabase.from('tournament_teams').select('team_id, disqualified, display_name, teams(id, name, short_name, logo_url)').eq('tournament_id', id), 'team_id'),
      fetchAllRows<AnyRow>(supabase.from('tournament_players').select('player_id, team_id, coach_role, players(id, nickname, nationality_code)').eq('tournament_id', id), 'player_id'),
      supabase.from('combined_scoreboards').select('id, name, order_num, tab_order, advance_count, eliminate_count, scoring_rule_id, scoring_rules(*)').eq('tournament_id', id).order('order_num'),
      stageIds.length === 0 ? Promise.resolve({ data: [] as AnyRow[] }) : fetchAllRows<AnyRow>(supabase.from('combined_scoreboard_stages').select('combined_scoreboard_id, stage_id').in('stage_id', stageIds)),
      stageIds.length === 0 ? Promise.resolve({ data: [] as AnyRow[] }) : fetchAllRows<AnyRow>(svcSupabase.from('stage_player_stats').select(SPS_SELECT).in('stage_id', stageIds)),
      seriesIds.length === 0 ? Promise.resolve({ data: [] as AnyRow[] }) : fetchAllRows<AnyRow>(svcSupabase.from('series_player_stats').select(SRPS_SELECT).in('series_id', seriesIds)),
      stageIds.length === 0 ? Promise.resolve({ data: [] as AnyRow[] }) : fetchAllRows<AnyRow>(svcSupabase.from('stage_team_stats').select(STS_SELECT).in('stage_id', stageIds)),
      seriesIds.length === 0 ? Promise.resolve({ data: [] as AnyRow[] }) : fetchAllRows<AnyRow>(svcSupabase.from('series_team_stats').select(SRTS_SELECT).in('series_id', seriesIds)),
    ])

    const allMatches = await matchesPromise
    // Re-attach matches to their stages so downstream code keeps the same shape.
    const matchesByStage = new Map<string, AnyRow[]>()
    for (const m of allMatches) {
      const sid = m.stage_id as string
      if (!matchesByStage.has(sid)) matchesByStage.set(sid, [])
      matchesByStage.get(sid)!.push(m)
    }
    for (const stage of (stagesData ?? []) as AnyRow[]) {
      stage.matches = matchesByStage.get(stage.id as string) ?? []
    }
    const allImportedMatchIds: string[] = []
    for (const m of allMatches) {
      if (m.status === 'imported') allImportedMatchIds.push(m.id as string)
    }

    // Now run the matchId-dependent fetches, which can also overlap with the
    // tail of any still-in-flight side queries.
    const [trData, psData, [[{ data: allAliasData }, { data: dropLocData }, { data: playerAliasData }], { data: additionalPtsData }, { data: wwcdRewardsData }, { data: specialAwardsData }, { data: stagePrizeConfigData }, { data: seriesPrizeConfigData }, { data: rosterTeamsData }, { data: rosterPlayersData }, { data: combinedData }, { data: combinedStageData }, { data: stagePsData }, { data: seriesPsData }, { data: stageTeamStatsData }, { data: seriesTeamStatsData }], { data: tpsData }] = await Promise.all([
      allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages(supabase, 'match_team_results', TR_SELECT, allImportedMatchIds),
      allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages(supabase, 'match_player_stats', PS_SELECT, allImportedMatchIds),
      sideQueriesPromise,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAllRows<AnyRow>((supabase as any).from('tournament_player_stats').select('*').eq('tournament_id', id)),
    ])

    return { stagesData, prizeConfigData, seriesData, trData, psData, allAliasData, dropLocData, playerAliasData, additionalPtsData, wwcdRewardsData, specialAwardsData, stagePrizeConfigData, seriesPrizeConfigData, rosterTeamsData, rosterPlayersData, combinedData, combinedStageData, tpsData, stagePsData, seriesPsData, stageTeamStatsData, seriesTeamStatsData }
  },
  ['tournament-data'],
  // Tag lets admin saves call revalidateTag('tournament-data') for an
  // immediate refresh; the 30s revalidate is just a backstop.
  { revalidate: 30, tags: ['tournament-data'] }
)

function resolveLogoUrl(teamId: string | null, name: string, lookup: Record<string, string | null>): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

export default async function TournamentContent({ id, tournament }: { id: string; tournament: Tournament }) {
  const t = tournament

  const { stagesData, prizeConfigData, seriesData, trData, psData, allAliasData, dropLocData, playerAliasData, additionalPtsData, wwcdRewardsData, specialAwardsData, stagePrizeConfigData, seriesPrizeConfigData, rosterTeamsData, rosterPlayersData, combinedData, combinedStageData, tpsData, stagePsData, seriesPsData, stageTeamStatsData, seriesTeamStatsData } = await loadTournamentData(id)

  // stageId → { teamId|teamNameLower → extraPts }
  const stageAdditionalPts: Record<string, Record<string, number>> = {}
  for (const ap of (additionalPtsData ?? []) as AnyRow[]) {
    if (!stageAdditionalPts[ap.stage_id]) stageAdditionalPts[ap.stage_id] = {}
    if (ap.team_id) stageAdditionalPts[ap.stage_id][ap.team_id as string] = Number(ap.points)
    stageAdditionalPts[ap.stage_id][(ap.team_name as string).toLowerCase()] = Number(ap.points)
  }

  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]
  const prizeConfig = (prizeConfigData ?? []) as TournamentPrizeConfig[]
  const seriesList = (seriesData ?? []) as Series[]

  // Match IDs belonging to stages that are excluded from totals (include_in_total === false)
  const excludedFromTotalMatchIds = new Set<string>()
  for (const stage of stagesList) {
    if ((stage as AnyRow).include_in_total === false) {
      for (const m of stage.matches) excludedFromTotalMatchIds.add(m.id)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsByMatch: Record<string, any[]> = {}
  const damageByMatch: Record<string, { placement: number; damage_dealt: number }[]> = {}
  const playerStatsMap = new Map<string, PlayerStatRow>()
  const mapsSet = new Set<string>()

  const matchToRule = new Map<string, ReturnType<typeof ruleFromStage>>()
  for (const stage of stagesList) {
    const rule = ruleFromStage(stage.scoring_rules)
    for (const m of stage.matches) {
      matchToRule.set(m.id, rule)
      if (m.status === 'imported') {
        if (m.map) mapsSet.add(m.map)
      }
    }
  }

  // Build pubg name → player_id lookup from aliases. Index every variant of
  // the alias (full + after-first-underscore suffix) so a row whose
  // pubg_player_name carries a TAG_ prefix still resolves when the alias
  // table only stores the bare nick.
  const pubgNameToPlayerId = new Map<string, string>()
  for (const a of playerAliasData ?? []) {
    const row = a as AnyRow
    for (const v of getNameVariants(row.alias as string)) {
      if (!pubgNameToPlayerId.has(v)) pubgNameToPlayerId.set(v, row.player_id as string)
    }
  }

  // Build resultsByMatch from team results + a teamId→global teams.name lookup
  // used as fallback when looking up stage_additional_points by team name.
  const teamIdToTeamsName = new Map<string, string>()
  for (const r of trData ?? []) {
    const row = r as AnyRow
    if (!resultsByMatch[row.match_id]) resultsByMatch[row.match_id] = []
    resultsByMatch[row.match_id].push(row)
    if (row.team_id && row.teams?.name) teamIdToTeamsName.set(row.team_id as string, row.teams.name as string)
  }

  // Build pubg_player_name → player_id from stats that ARE linked within this
  // tournament. Index every variant so the same nick across stages with
  // different team-tag prefixes (TAG1_Nick vs TAG2_Nick after a transfer)
  // still resolves to the same player.
  const nameToPlayerIdLocal = new Map<string, string>()
  // Stable account_id → player_id mapping built from any linked row in this
  // tournament. account_id doesn't change when a player renames or moves
  // teams, so it catches splits the name lookup misses.
  const accountIdToPlayerId = new Map<string, string>()
  for (const d of psData ?? []) {
    const row = d as AnyRow
    const pid = row.player_id as string | null
    if (!pid) continue
    if (row.pubg_player_name) {
      for (const v of getNameVariants(row.pubg_player_name as string)) {
        if (!nameToPlayerIdLocal.has(v)) nameToPlayerIdLocal.set(v, pid)
      }
    }
    if (row.pubg_account_id) accountIdToPlayerId.set(row.pubg_account_id as string, pid)
  }

  // Build alias logo lookup (must be before player stats for logo resolution)
  const aliasLogoLookup: Record<string, string | null> = {}
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      if (r.team_id && r.teams?.logo_url) {
        const mainKey = `${r.team_id}:`
        if (!(mainKey in aliasLogoLookup)) aliasLogoLookup[mainKey] = r.teams.logo_url
      }
    }
  }
  for (const a of allAliasData ?? []) {
    const row = a as AnyRow
    if (!row.logo_url) continue
    aliasLogoLookup[`${row.team_id}:${row.alias}`] = row.logo_url
    const dashIdx = (row.alias as string).indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = (row.alias as string).slice(0, dashIdx).trim()
      if (tagPart) aliasLogoLookup[`${row.team_id}:${tagPart}`] = row.logo_url
    }
  }

  // When a tournament has a registered team roster, prefer those teams' aliases
  // for tag → team / tag → display-name lookups. Two unrelated teams sharing a
  // tag (e.g. "DN") would otherwise resolve to whichever was processed first.
  const registeredTeamIds = new Set<string>(
    ((rosterTeamsData ?? []) as AnyRow[])
      .map((r) => ((r.teams as AnyRow | null)?.id as string | null) ?? null)
      .filter((x): x is string => !!x)
  )
  const aliasRows = (allAliasData ?? []).slice().sort((a, b) => {
    const ar = registeredTeamIds.has((a as AnyRow).team_id) ? 0 : 1
    const br = registeredTeamIds.has((b as AnyRow).team_id) ? 0 : 1
    return ar - br
  })

  const aliasToTeamId = new Map<string, string>()
  const aliasTagToName = new Map<string, string>()
  for (const a of aliasRows) {
    const row = a as AnyRow
    if (!aliasToTeamId.has(row.alias.toLowerCase())) {
      aliasToTeamId.set(row.alias.toLowerCase(), row.team_id)
    }
    const dashIdx = (row.alias as string).indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = row.alias.slice(0, dashIdx).trim().toLowerCase()
      const namePart = row.alias.slice(dashIdx + 3).trim()
      if (tagPart && !aliasToTeamId.has(tagPart)) aliasToTeamId.set(tagPart, row.team_id)
      if (tagPart && namePart && !aliasTagToName.has(tagPart)) aliasTagToName.set(tagPart, namePart)
      if (namePart && !aliasTagToName.has(row.alias.toLowerCase())) aliasTagToName.set(row.alias.toLowerCase(), namePart)
    }
  }

  // Per-tournament display_name override (tournament_teams.display_name) — set
  // by Bulk Add Teams so the public participants list / scoreboard show the
  // period-correct label even after the team's global teams.name is renamed.
  const teamTournamentDisplayName = new Map<string, string>()
  for (const tt of (rosterTeamsData ?? []) as AnyRow[]) {
    const tid = tt.team_id as string | null
    const dn = tt.display_name as string | null
    if (tid && dn) teamTournamentDisplayName.set(tid, dn)
  }

  function resolveTeamName(pubgName: string | null, teamsName: string | null, displayName: string | null, teamId: string | null = null): string {
    if (teamId) {
      const ttDisplay = teamTournamentDisplayName.get(teamId)
      if (ttDisplay) return ttDisplay
    }
    if (displayName) return displayName
    const key = (pubgName ?? '').toLowerCase()
    return aliasTagToName.get(key) ?? teamsName ?? stripTagPrefix(pubgName ?? '?')
  }

  // Assign _resolvedName on team results (must be before player stats building)
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      r._resolvedName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name, r.team_id ?? null)
    }
  }

  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || !r.pubg_team_name) continue
      const aliasLogo = aliasLogoLookup[`${effectiveId}:${r.pubg_team_name}`]
      if (!aliasLogo) continue
      const displayedName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name, r.team_id ?? null)
      const displayKey = `${effectiveId}:${displayedName}`
      if (!(displayKey in aliasLogoLookup)) aliasLogoLookup[displayKey] = aliasLogo
    }
  }

  // Build damageByMatch + playerStatsMap + playerStatsByMatch
  // Team name uses _resolvedName from match_team_results (tournament-specific alias, not current DB name)
  const playerStatsByMatch: Record<string, PlayerMatchStat[]> = {}
  const seenPerMatch: Record<string, Set<string>> = {}

  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (!damageByMatch[row.match_id]) damageByMatch[row.match_id] = []
    damageByMatch[row.match_id].push({ placement: row.placement, damage_dealt: Number(row.damage_dealt ?? 0) })

    // Resolve player_id by every available signal so the same player doesn't
    // split into two map entries (linked rows under uuid + unlinked rows
    // under `pubg:Name`). Order: explicit player_id → stable PUBG account
    // id → exact name in this tournament's linked rows → alias-table match
    // (full name or after-prefix variant).
    const accountId = (row.pubg_account_id as string | null) ?? null
    const pubgName = (row.pubg_player_name as string | null) ?? ''
    let resolvedPlayerId: string | null = (row.player_id as string | null) ?? null
    if (!resolvedPlayerId && accountId) {
      resolvedPlayerId = accountIdToPlayerId.get(accountId) ?? null
    }
    if (!resolvedPlayerId && pubgName) {
      for (const v of getNameVariants(pubgName)) {
        const hit = nameToPlayerIdLocal.get(v) ?? pubgNameToPlayerId.get(v) ?? null
        if (hit) { resolvedPlayerId = hit; break }
      }
    }

    const nickname = row.display_name ?? row.players?.nickname ?? row.pubg_player_name ?? '?'
    const pubgPlayerName: string = pubgName
    // Resolve team name from match_team_results (same as participant display) instead of current DB name
    const matchTeamResult = row.team_id
      ? (resultsByMatch[row.match_id] ?? []).find((r: AnyRow) => r.team_id === row.team_id)
      : null
    const teamName = matchTeamResult?._resolvedName ?? row.teams?.name ?? stripTagPrefix(row.pubg_player_name?.split('_')[0] ?? '?')
    const logoUrl = row.team_id ? resolveLogoUrl(row.team_id, teamName, aliasLogoLookup) : null

    // Even when player_id resolution fails, fall back to the stable
    // pubg_account_id so renamed-but-same-account rows stay in one bucket.
    const key = resolvedPlayerId ?? (accountId ? `pubg-acct:${accountId}` : `pubg:${pubgPlayerName.toLowerCase()}`)

    // Only fold into total player stats for ON stages; per-match display always populated
    if (!excludedFromTotalMatchIds.has(row.match_id as string)) {
      if (!playerStatsMap.has(key)) {
        playerStatsMap.set(key, {
          playerId: resolvedPlayerId,
          nickname,
          teamId: row.team_id ?? null,
          teamName,
          logoUrl,
          games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0,
          walkDistance: 0, rideDistance: 0, longestKill: 0, swimDistance: 0,
          revives: 0, healsUsed: 0, boostsUsed: 0,
        })
      }
      const e = playerStatsMap.get(key)!
      e.games++
      e.kills += row.kills ?? 0
      e.assists += row.assists ?? 0
      e.knocks += row.knocks ?? 0
      e.headshotKills += row.headshot_kills ?? 0
      e.damage += Number(row.damage_dealt ?? 0)
      e.survivalTime += row.survival_time ?? 0
      e.walkDistance = (e.walkDistance ?? 0) + Number(row.walk_distance ?? 0)
      e.rideDistance = (e.rideDistance ?? 0) + Number(row.ride_distance ?? 0)
      e.swimDistance = (e.swimDistance ?? 0) + Number(row.swim_distance ?? 0)
      e.longestKill = Math.max(e.longestKill ?? 0, Number(row.longest_kill ?? 0))
      e.revives = (e.revives ?? 0) + (row.revives ?? 0)
      e.healsUsed = (e.healsUsed ?? 0) + (row.heals_used ?? 0)
      e.boostsUsed = (e.boostsUsed ?? 0) + (row.boosts_used ?? 0)
    }

    if (!seenPerMatch[row.match_id]) seenPerMatch[row.match_id] = new Set()
    if (seenPerMatch[row.match_id].has(key)) continue
    seenPerMatch[row.match_id].add(key)

    if (!playerStatsByMatch[row.match_id]) playerStatsByMatch[row.match_id] = []
    playerStatsByMatch[row.match_id].push({
      playerId: resolvedPlayerId,
      pubgPlayerName,
      nickname,
      teamId: row.team_id ?? null,
      teamName,
      logoUrl,
      kills: row.kills ?? 0,
      assists: row.assists ?? 0,
      knocks: row.knocks ?? 0,
      headshotKills: row.headshot_kills ?? 0,
      damage: Number(row.damage_dealt ?? 0),
      survivalTime: row.survival_time ?? 0,
      walkDistance: Number(row.walk_distance ?? 0),
      rideDistance: Number(row.ride_distance ?? 0),
      swimDistance: Number(row.swim_distance ?? 0),
      longestKill: Number(row.longest_kill ?? 0),
      revives: row.revives ?? 0,
      healsUsed: row.heals_used ?? 0,
      boostsUsed: row.boosts_used ?? 0,
      placement: row.placement ?? null,
    })
  }

  // Build team stats (total — excludes stages with include_in_total === false)
  const teamStatsMap = new Map<string, TeamStatRow>()
  for (const [matchId, rows] of Object.entries(resultsByMatch)) {
    if (excludedFromTotalMatchIds.has(matchId)) continue
    const rule = matchToRule.get(matchId) ?? ruleFromStage(null)
    for (const r of rows as AnyRow[]) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      if (!teamStatsMap.has(key)) {
        const tName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name, r.team_id ?? null)
        teamStatsMap.set(key, {
          teamId: r.team_id ?? null,
          teamName: tName,
          logoUrl: resolveLogoUrl(r.team_id, tName, aliasLogoLookup),
          games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
        })
      }
      const e = teamStatsMap.get(key)!
      e.games++
      if (r.placement === 1) e.wwcd++
      e.totalKills += r.total_kills ?? 0
      e.totalDamage += Number(r.total_damage ?? 0)
      const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
      e.totalPoints += pp + Math.round((r.total_kills ?? 0) * rule.kill_pts)
      if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
    }
  }

  // Build roster from match data
  const teamRosterMap = new Map<string, { name: string; logo_url: string | null; players: Map<string, { id: string; nickname: string; nationality: string | null; coachRole: 'coach' | 'playing_coach' | null }> }>()
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || teamRosterMap.has(effectiveId)) continue
      const displayName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name, r.team_id ?? null)
      const resolvedLogo = aliasLogoLookup[`${effectiveId}:${displayName}`] ?? aliasLogoLookup[`${effectiveId}:`] ?? null
      teamRosterMap.set(effectiveId, { name: displayName, logo_url: resolvedLogo, players: new Map() })
    }
  }
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (!row.team_id || !row.player_id || !row.players) continue
    const team = teamRosterMap.get(row.team_id)
    if (team && !team.players.has(row.player_id)) {
      team.players.set(row.player_id, {
        id: row.player_id,
        nickname: row.players.nickname,
        nationality: row.players.nationality_code ?? null,
        coachRole: null,
      })
    }
  }

  // Tournament-scoped disqualified teams — pulled from tournament_teams.disqualified
  const dqTeamIds = new Set<string>(
    ((rosterTeamsData ?? []) as AnyRow[])
      .filter((r) => r.disqualified)
      .map((r) => ((r.teams as AnyRow | null)?.id as string | null) ?? null)
      .filter((x): x is string => !!x)
  )

  for (const r of (rosterTeamsData ?? []) as AnyRow[]) {
    const t = r.teams as AnyRow | null
    if (!t?.id) continue
    const teamId = t.id as string
    const tName = (t.name as string) ?? '?'
    const logoUrl = (t.logo_url as string | null) ?? aliasLogoLookup[`${teamId}:`] ?? null
    if (teamRosterMap.has(teamId)) {
      const entry = teamRosterMap.get(teamId)!
      if (logoUrl && !entry.logo_url) entry.logo_url = logoUrl
    } else {
      // Team registered in admin but has no match data yet — still show in roster
      const displayName = (r.display_name as string | null) ?? tName
      teamRosterMap.set(teamId, { name: displayName, logo_url: logoUrl, players: new Map() })
    }
    if (!teamStatsMap.has(teamId)) {
      teamStatsMap.set(teamId, {
        teamId, teamName: tName, logoUrl,
        games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
      })
    }
  }

  // Add all admin-registered players (including those with no match data).
  // Runs after rosterTeamsData so teams-with-no-matches are already in the map.
  // Also overwrites coachRole for players already added from match stats.
  for (const d of rosterPlayersData ?? []) {
    const row = d as AnyRow
    if (!row.player_id || !row.team_id || !row.players) continue
    const team = teamRosterMap.get(row.team_id as string)
    if (!team) continue
    team.players.set(row.player_id as string, {
      id: row.player_id as string,
      nickname: (row.players as AnyRow).nickname as string,
      nationality: ((row.players as AnyRow).nationality_code as string | null) ?? null,
      coachRole: (row.coach_role as 'coach' | 'playing_coach' | null) ?? null,
    })
  }

  // Build playerStats from pre-computed tournament_player_stats table.
  // Falls back to live match_player_stats aggregation when pre-computed table is empty
  // (e.g. table not yet populated, survival_time column missing, or delete/insert race window).
  const tpsRows = (tpsData ?? []) as AnyRow[]
  const tpsPlayerIds = new Set(tpsRows.map((r) => r.player_id as string | null).filter((id): id is string => !!id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mapPlayerRow(r: AnyRow): PlayerStatRow {
    return {
      playerId: (r.player_id ?? null) as string | null,
      nickname: r.nickname as string,
      teamId: (r.team_id ?? null) as string | null,
      teamName: r.team_name as string,
      logoUrl: (r.logo_url ?? null) as string | null,
      games: (r.games as number) ?? 0,
      kills: (r.kills as number) ?? 0,
      assists: (r.assists as number) ?? 0,
      knocks: (r.knocks as number) ?? 0,
      headshotKills: (r.headshot_kills as number) ?? 0,
      damage: Number(r.damage ?? 0),
      survivalTime: Number(r.survival_time ?? 0),
      walkDistance: Number(r.walk_distance ?? 0),
      rideDistance: Number(r.ride_distance ?? 0),
      longestKill: Number(r.longest_kill ?? 0),
      swimDistance: Number(r.swim_distance ?? 0),
      revives: (r.revives as number) ?? 0,
      healsUsed: (r.heals_used as number) ?? 0,
      boostsUsed: (r.boosts_used as number) ?? 0,
      deaths: (r.deaths as number) ?? 0,
      damageTaken: Number(r.damage_taken ?? 0),
      blueZoneDamage: Number(r.blue_zone_damage ?? 0),
      knockDamageSum: Number(r.knock_damage_sum ?? 0),
      engagementDistSum: Number(r.engagement_dist_sum ?? 0),
      engagementDistCount: (r.engagement_dist_count as number) ?? 0,
      firstBloodKills: (r.first_blood_kills as number) ?? 0,
      firstBloodKnocks: (r.first_blood_knocks as number) ?? 0,
      stealKills: (r.steal_kills as number) ?? 0,
      stolenKills: (r.stolen_kills as number) ?? 0,
      grenadesThrown: (r.grenades_thrown as number) ?? 0,
      smokesThrown: (r.smokes_thrown as number) ?? 0,
      flashbangsThrown: (r.flashbangs_thrown as number) ?? 0,
      molotovsThrown: (r.molotovs_thrown as number) ?? 0,
      bzGrenadesThrown: (r.bz_grenades_thrown as number) ?? 0,
      decoyGrenadesThrown: (r.decoy_grenades_thrown as number) ?? 0,
      grenadeDamage: Number(r.grenade_damage ?? 0),
      molotovDamage: Number(r.molotov_damage ?? 0),
      bzGrenadeDamage: Number(r.bz_grenade_damage ?? 0),
      grenadeHitEvents: (r.grenade_hit_events as number) ?? 0,
      totalHealAmount: Number(r.total_heal_amount ?? 0),
      blueZoneTime: (r.blue_zone_time as number) ?? 0,
      vehicleTime: (r.vehicle_time as number) ?? 0,
      roadKills: (r.road_kills as number) ?? 0,
      vehicleDestroys: (r.vehicle_destroys as number) ?? 0,
      teamKills: (r.team_kills as number) ?? 0,
      revivesGiven: (r.revives_given as number) ?? 0,
      assistDamage: Number(r.assist_damage ?? 0),
      tradeKills: (r.trade_kills as number) ?? 0,
      tradeableDeaths: (r.tradeable_deaths as number) ?? 0,
      zoneEdgeSamples: (r.zone_edge_samples as number) ?? 0,
      zoneTotalSamples: (r.zone_total_samples as number) ?? 0,
      zoneOutsideSamples: (r.zone_outside_samples as number) ?? 0,
      zoneDistSum: Number(r.zone_dist_sum ?? 0),
    }
  }

  const playerStats: PlayerStatRow[] = tpsRows.length > 0
    ? tpsRows.map(mapPlayerRow)
    : [...playerStatsMap.values()]

  // Update coachRole for players already present in teamRosterMap (from match data)
  for (const r of (rosterPlayersData ?? []) as AnyRow[]) {
    const p = r.players as AnyRow | null
    if (!p?.id) continue
    const playerId = p.id as string
    const tournamentTeamId = (r.team_id as string | null) ?? null
    const coachRole = (r.coach_role as 'coach' | 'playing_coach' | null) ?? null

    if (tournamentTeamId && coachRole) {
      const team = teamRosterMap.get(tournamentTeamId)
      const existing = team?.players.get(playerId)
      if (existing) existing.coachRole = coachRole
    }
  }
  playerStats.sort((a, b) => b.kills - a.kills)

  const stagePlayerStats: Record<string, PlayerStatRow[]> = {}
  for (const r of (stagePsData ?? []) as AnyRow[]) {
    const sid = r.stage_id as string
    if (!stagePlayerStats[sid]) stagePlayerStats[sid] = []
    stagePlayerStats[sid].push(mapPlayerRow({ ...r, player_id: r.player_id, team_id: r.team_id, team_name: r.team_name, logo_url: r.logo_url }))
  }

  const seriesPlayerStats: Record<string, PlayerStatRow[]> = {}
  for (const r of (seriesPsData ?? []) as AnyRow[]) {
    const sid = r.series_id as string
    if (!seriesPlayerStats[sid]) seriesPlayerStats[sid] = []
    seriesPlayerStats[sid].push(mapPlayerRow({ ...r, player_id: r.player_id, team_id: r.team_id, team_name: r.team_name, logo_url: r.logo_url }))
  }

  function mapTeamExtRow(r: AnyRow): TeamExtRow {
    return {
      teamId: (r.team_id ?? null) as string | null,
      kills: (r.kills as number) ?? 0,
      assists: (r.assists as number) ?? 0,
      knocks: (r.knocks as number) ?? 0,
      headshotKills: (r.headshot_kills as number) ?? 0,
      damage: Number(r.damage ?? 0),
      survivalTime: Number(r.survival_time ?? 0),
      deaths: (r.deaths as number) ?? 0,
      longestKill: Number(r.longest_kill ?? 0),
      knockDamageSum: Number(r.knock_damage_sum ?? 0),
      engagementDistSum: Number(r.engagement_dist_sum ?? 0),
      engagementDistCount: (r.engagement_dist_count as number) ?? 0,
      stealKills: (r.steal_kills as number) ?? 0,
      stolenKills: (r.stolen_kills as number) ?? 0,
      grenadesThrown: (r.grenades_thrown as number) ?? 0,
      smokesThrown: (r.smokes_thrown as number) ?? 0,
      flashbangsThrown: (r.flashbangs_thrown as number) ?? 0,
      molotovsThrown: (r.molotovs_thrown as number) ?? 0,
      bzGrenadesThrown: (r.bz_grenades_thrown as number) ?? 0,
      decoyGrenadesThrown: (r.decoy_grenades_thrown as number) ?? 0,
      grenadeDamage: Number(r.grenade_damage ?? 0),
      molotovDamage: Number(r.molotov_damage ?? 0),
      bzGrenadeDamage: Number(r.bz_grenade_damage ?? 0),
      grenadeHitEvents: (r.grenade_hit_events as number) ?? 0,
      damageTaken: Number(r.damage_taken ?? 0),
      blueZoneDamage: Number(r.blue_zone_damage ?? 0),
      healsUsed: (r.heals_used as number) ?? 0,
      boostsUsed: (r.boosts_used as number) ?? 0,
      totalHealAmount: Number(r.total_heal_amount ?? 0),
      revives: (r.revives as number) ?? 0,
      blueZoneTime: (r.blue_zone_time as number) ?? 0,
      walkDistance: Number(r.walk_distance ?? 0),
      rideDistance: Number(r.ride_distance ?? 0),
      swimDistance: Number(r.swim_distance ?? 0),
      vehicleTime: (r.vehicle_time as number) ?? 0,
      revivesGiven: (r.revives_given as number) ?? 0,
      assistDamage: Number(r.assist_damage ?? 0),
      tradeKills: (r.trade_kills as number) ?? 0,
      tradeableDeaths: (r.tradeable_deaths as number) ?? 0,
      zoneEdgeSamples: (r.zone_edge_samples as number) ?? 0,
      zoneTotalSamples: (r.zone_total_samples as number) ?? 0,
      zoneOutsideSamples: (r.zone_outside_samples as number) ?? 0,
      zoneDistSum: Number(r.zone_dist_sum ?? 0),
      playerEntries: (r.player_entries as number) ?? 0,
    }
  }

  const stageTeamStats: Record<string, TeamExtRow[]> = {}
  for (const r of (stageTeamStatsData ?? []) as AnyRow[]) {
    const sid = r.stage_id as string
    if (!stageTeamStats[sid]) stageTeamStats[sid] = []
    stageTeamStats[sid].push(mapTeamExtRow(r))
  }

  const seriesTeamStats: Record<string, TeamExtRow[]> = {}
  for (const r of (seriesTeamStatsData ?? []) as AnyRow[]) {
    const sid = r.series_id as string
    if (!seriesTeamStats[sid]) seriesTeamStats[sid] = []
    seriesTeamStats[sid].push(mapTeamExtRow(r))
  }

  const teamStats: TeamStatRow[] = [...teamStatsMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)

  const roster = [...teamRosterMap.entries()]
    .map(([teamId, team]) => ({
      id: teamId, name: team.name, logo_url: team.logo_url,
      players: [...team.players.values()].sort((a, b) => {
        const aIsCoach = a.coachRole != null ? 1 : 0
        const bIsCoach = b.coachRole != null ? 1 : 0
        if (aIsCoach !== bIsCoach) return aIsCoach - bIsCoach
        return a.nickname.localeCompare(b.nickname)
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Per-stage standings → rank board (excludes stages with include_in_total === false)
  type StandingsEntry = { teamId: string | null; teamName: string; totalPts: number; placePts: number; killPts: number; wwcd: number; lastMatchKills: number; lastMatchPlacement: number; lastMatchTotalPts: number }
  const stageStandingsMap = new Map<string, StandingsEntry[]>()
  for (const stage of stagesList) {
    if ((stage as AnyRow).include_in_total === false) continue
    const stageRule = ruleFromStage(stage.scoring_rules)
    const lastImportedMatchId = stage.matches
      .filter(m => m.status === 'imported')
      .sort((a, b) => a.order_num - b.order_num)
      .at(-1)?.id ?? null
    const ptsMap = new Map<string, StandingsEntry>()
    for (const m of stage.matches) {
      if (m.status !== 'imported') continue
      for (const r of resultsByMatch[m.id] ?? []) {
        const row = r as AnyRow
        const key = row.team_id ?? `pubg:${row.pubg_team_name ?? ''}`
        if (!ptsMap.has(key)) {
          ptsMap.set(key, { teamId: row.team_id ?? null, teamName: resolveTeamName(row.pubg_team_name, row.teams?.name ?? null, row.display_name), totalPts: 0, placePts: 0, killPts: 0, wwcd: 0, lastMatchKills: 0, lastMatchPlacement: 99, lastMatchTotalPts: 0 })
        }
        const e = ptsMap.get(key)!
        const matchRule = matchToRule.get(m.id) ?? ruleFromStage(null)
        const pp = calcPlacementPtsWithRule(row.placement ?? 99, matchRule)
        const kp = Math.round((row.total_kills ?? 0) * matchRule.kill_pts)
        e.totalPts += pp + kp
        e.placePts += pp
        e.killPts += kp
        if ((row.placement ?? 99) === 1) e.wwcd++
        if (m.id === lastImportedMatchId) {
          const lmPP = calcPlacementPtsWithRule(row.placement ?? 99, matchRule)
          e.lastMatchKills = row.total_kills ?? 0
          e.lastMatchPlacement = row.placement ?? 99
          e.lastMatchTotalPts = lmPP + Math.round((row.total_kills ?? 0) * matchRule.kill_pts)
        }
      }
    }
    // Include additional pts so rank-based prizes and PGC points are assigned
    // on the same totals the scoreboard shows.
    const extraForStage = stageAdditionalPts[stage.id] ?? {}
    for (const e of ptsMap.values()) {
      e.totalPts += (e.teamId ? extraForStage[e.teamId] : undefined) ?? extraForStage[e.teamName.toLowerCase()] ?? 0
    }
    const entries = [...ptsMap.entries()]

    function sortBySubType(arr: typeof entries, subType: string) {
      if (subType === 'chicken_v2') {
        return arr.sort(([, a], [, b]) => {
          if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
          if (b.killPts !== a.killPts) return b.killPts - a.killPts
          if (b.lastMatchKills !== a.lastMatchKills) return b.lastMatchKills - a.lastMatchKills
          return a.lastMatchPlacement - b.lastMatchPlacement
        })
      }
      if (subType === 'chicken') {
        return arr.sort(([, a], [, b]) => {
          if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
          if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
          return b.placePts - a.placePts
        })
      }
      if (subType === 'super_v1') {
        return arr.sort(([, a], [, b]) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.killPts !== a.killPts ? b.killPts - a.killPts : b.placePts - a.placePts)
      }
      if (subType === 'super_v2') {
        return arr.sort(([, a], [, b]) => {
          if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
          if (b.placePts !== a.placePts) return b.placePts - a.placePts
          if (b.lastMatchTotalPts !== a.lastMatchTotalPts) return b.lastMatchTotalPts - a.lastMatchTotalPts
          return a.lastMatchPlacement - b.lastMatchPlacement
        })
      }
      return arr.sort(([, a], [, b]) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
    }

    let sortedEntries: StandingsEntry[]
    if (stageRule.type === 'smash') {
      const lastMatchResults = (resultsByMatch[lastImportedMatchId ?? ''] ?? []) as AnyRow[]
      const lastWinner = lastMatchResults.find(r => (r.placement ?? 99) === 1)
      const winnerKey = lastWinner ? (lastWinner.team_id ?? `pubg:${lastWinner.pubg_team_name ?? ''}`) as string : null
      const winnerEntry = winnerKey ? ptsMap.get(winnerKey) ?? null : null
      const restKeys = entries.filter(([k]) => k !== winnerKey)
      sortBySubType(restKeys, stageRule.smash_sub_type ?? 'super')
      const restValues = restKeys.map(([, e]) => e)
      sortedEntries = winnerEntry ? [winnerEntry, ...restValues] : restValues
    } else if (stageRule.type === 'chicken_v2') {
      sortedEntries = sortBySubType(entries, 'chicken_v2').map(([, e]) => e)
    } else {
      sortedEntries = sortBySubType(entries, stageRule.type ?? 'super').map(([, e]) => e)
    }
    stageStandingsMap.set(stage.id, sortedEntries)
  }

  // Series cumulative standings — built early so rank-board mapping below can
  // reference series_id targets, and the WWCD / series-prize folds further
  // down can reuse the same map.
  type SeriesStandingEntry = { teamId: string | null; teamName: string; matches: number; wwcd: number; placePts: number; killPts: number; totalPts: number; lastMatchKills: number; lastMatchPlacement: number; lastMatchTotalPts: number }
  const seriesStandingsMap = new Map<string, SeriesStandingEntry[]>()
  type SeriesMatchRecord = { matchId: string; stageOrder: number; matchOrder: number; totalPts: number; placement: number }
  for (const sr of seriesList) {
    const seriesStages = stagesList.filter((s) => s.series_id === sr.id && (s as AnyRow).include_in_total !== false)
    if (seriesStages.length === 0) continue
    const teamMatchHistory = new Map<string, SeriesMatchRecord[]>()
    const ptsMap = new Map<string, SeriesStandingEntry>()
    for (const stage of seriesStages) {
      const rule = ruleFromStage(stage.scoring_rules)
      for (const m of stage.matches) {
        if (m.status !== 'imported') continue
        for (const r of (resultsByMatch[m.id] ?? []) as AnyRow[]) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          if (!ptsMap.has(key)) {
            ptsMap.set(key, {
              teamId: r.team_id ?? null,
              teamName: r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '?'),
              matches: 0, wwcd: 0, placePts: 0, killPts: 0, totalPts: 0, lastMatchKills: 0, lastMatchPlacement: 99, lastMatchTotalPts: 0,
            })
          }
          const e = ptsMap.get(key)!
          const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
          const kp = Math.round((r.total_kills ?? 0) * rule.kill_pts)
          e.placePts += pp
          e.killPts += kp
          e.totalPts += pp + kp
          e.matches++
          if ((r.placement ?? 99) === 1) e.wwcd++
          if (!teamMatchHistory.has(key)) teamMatchHistory.set(key, [])
          teamMatchHistory.get(key)!.push({ matchId: m.id, stageOrder: stage.order_num, matchOrder: m.order_num, totalPts: pp + kp, placement: r.placement ?? 99 })
        }
      }
      const extraForStage = stageAdditionalPts[stage.id] ?? {}
      for (const e of ptsMap.values()) {
        e.totalPts += (e.teamId ? extraForStage[e.teamId] : undefined) ?? extraForStage[e.teamName.toLowerCase()] ?? 0
      }
    }
    for (const hist of teamMatchHistory.values()) {
      hist.sort((a, b) => a.stageOrder !== b.stageOrder ? a.stageOrder - b.stageOrder : a.matchOrder - b.matchOrder)
    }
    const seriesOwnRule = (sr as AnyRow).scoring_rules
    const seriesRule = seriesOwnRule ? ruleFromStage(seriesOwnRule) : seriesStages[0] ? ruleFromStage((seriesStages[0] as AnyRow).scoring_rules) : ruleFromStage(null)
    const seriesRuleType = seriesRule.type ?? 'super'
    const seriesEntries = [...ptsMap.entries()]
    if (seriesRuleType === 'super_v2') {
      seriesEntries.sort(([aKey, a], [bKey, b]) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
        if (b.placePts !== a.placePts) return b.placePts - a.placePts
        const aHist = teamMatchHistory.get(aKey) ?? []
        const bHist = teamMatchHistory.get(bKey) ?? []
        const bMatchIdSet = new Set(bHist.map((x) => x.matchId))
        for (let i = aHist.length - 1; i >= 0; i--) {
          if (bMatchIdSet.has(aHist[i].matchId)) {
            const aRec = aHist[i]
            const bRec = bHist.find((x) => x.matchId === aRec.matchId)!
            if (aRec.totalPts !== bRec.totalPts) return bRec.totalPts - aRec.totalPts
            return aRec.placement - bRec.placement
          }
        }
        return 0
      })
    } else if (seriesRuleType === 'super_v1') {
      seriesEntries.sort(([, a], [, b]) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.killPts !== a.killPts ? b.killPts - a.killPts : b.placePts - a.placePts)
    } else {
      seriesEntries.sort(([, a], [, b]) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
    }
    seriesStandingsMap.set(sr.id, seriesEntries.map(([, e]) => e))
  }

  // Combined scoreboards — view-only aggregations of any subset of stages.
  // Same shape as seriesStandingsMap so rankBoard / scoreboard view can treat them uniformly.
  type CombinedItem = { id: string; name: string; order_num: number; tab_order: number; advance_count: number | null; eliminate_count: number | null; stageIds: Set<string>; scoringRuleConfig: ReturnType<typeof ruleFromStage> | null }
  const combinedStagesByCombined = new Map<string, Set<string>>()
  for (const r of (combinedStageData ?? []) as AnyRow[]) {
    const cid = r.combined_scoreboard_id as string
    if (!combinedStagesByCombined.has(cid)) combinedStagesByCombined.set(cid, new Set())
    combinedStagesByCombined.get(cid)!.add(r.stage_id as string)
  }
  const combinedList: CombinedItem[] = ((combinedData ?? []) as AnyRow[]).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    order_num: c.order_num as number,
    tab_order: (c.tab_order as number) ?? 0,
    advance_count: (c.advance_count as number | null) ?? null,
    eliminate_count: (c.eliminate_count as number | null) ?? null,
    stageIds: combinedStagesByCombined.get(c.id as string) ?? new Set(),
    scoringRuleConfig: c.scoring_rules ? ruleFromStage(c.scoring_rules as { placement_pts: number[]; kill_pts: number; type: string }) : null,
  }))

  const combinedStandingsMap = new Map<string, SeriesStandingEntry[]>()
  for (const cb of combinedList) {
    if (cb.stageIds.size === 0) continue
    const cbRule = cb.scoringRuleConfig
    // Find last imported match across all combined stages (for tiebreakers)
    let lastCbMatchId: string | null = null
    let lastCbStageOrder = -Infinity
    let lastCbMatchOrder = -Infinity
    for (const stage of stagesList) {
      if (!cb.stageIds.has(stage.id)) continue
      for (const m of stage.matches) {
        if (m.status !== 'imported') continue
        if (stage.order_num > lastCbStageOrder || (stage.order_num === lastCbStageOrder && m.order_num > lastCbMatchOrder)) {
          lastCbStageOrder = stage.order_num
          lastCbMatchOrder = m.order_num
          lastCbMatchId = m.id
        }
      }
    }
    const ptsMap = new Map<string, SeriesStandingEntry>()
    for (const stage of stagesList) {
      if (!cb.stageIds.has(stage.id)) continue
      const rule = cbRule ?? ruleFromStage(stage.scoring_rules)
      for (const m of stage.matches) {
        if (m.status !== 'imported') continue
        for (const r of (resultsByMatch[m.id] ?? []) as AnyRow[]) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          if (!ptsMap.has(key)) {
            ptsMap.set(key, {
              teamId: r.team_id ?? null,
              teamName: r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '?'),
              matches: 0, wwcd: 0, placePts: 0, killPts: 0, totalPts: 0, lastMatchKills: 0, lastMatchPlacement: 99, lastMatchTotalPts: 0,
            })
          }
          const e = ptsMap.get(key)!
          const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
          const kp = Math.round((r.total_kills ?? 0) * rule.kill_pts)
          e.placePts += pp
          e.killPts += kp
          e.totalPts += pp + kp
          e.matches++
          if ((r.placement ?? 99) === 1) e.wwcd++
          if (m.id === lastCbMatchId) {
            e.lastMatchKills = r.total_kills ?? 0
            e.lastMatchPlacement = r.placement ?? 99
            e.lastMatchTotalPts = pp + kp
          }
        }
      }
      const extraForStage = stageAdditionalPts[stage.id] ?? {}
      for (const e of ptsMap.values()) {
        e.totalPts += (e.teamId ? extraForStage[e.teamId] : undefined) ?? extraForStage[e.teamName.toLowerCase()] ?? 0
      }
    }
    const cbEntries = [...ptsMap.values()]
    const cbRuleType = cbRule?.type ?? 'super'
    if (cbRuleType === 'chicken_v2') {
      cbEntries.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (b.killPts !== a.killPts) return b.killPts - a.killPts
        if (b.lastMatchKills !== a.lastMatchKills) return b.lastMatchKills - a.lastMatchKills
        return a.lastMatchPlacement - b.lastMatchPlacement
      })
    } else if (cbRuleType === 'chicken') {
      cbEntries.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
        return b.placePts - a.placePts
      })
    } else if (cbRuleType === 'super_v1') {
      cbEntries.sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.killPts !== a.killPts ? b.killPts - a.killPts : b.placePts - a.placePts)
    } else if (cbRuleType === 'super_v2') {
      cbEntries.sort((a, b) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
        if (b.placePts !== a.placePts) return b.placePts - a.placePts
        if (b.lastMatchTotalPts !== a.lastMatchTotalPts) return b.lastMatchTotalPts - a.lastMatchTotalPts
        return a.lastMatchPlacement - b.lastMatchPlacement
      })
    } else {
      cbEntries.sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
    }
    combinedStandingsMap.set(cb.id, cbEntries)
  }

  type RankEntry = { teamId: string | null; teamName: string; rank: number }
  const rankBoard: RankEntry[] = []
  const rankMethod = (t.ranking_method ?? 'stage') as 'stage' | 'prize' | 'pgs' | 'pgc'

  if (rankMethod === 'stage') {
    const hasMapping = prizeConfig.some((p) => (p.stage_id != null || p.series_id != null || p.combined_scoreboard_id != null) && p.stage_rank != null)
    if (hasMapping) {
      for (const pc of prizeConfig) {
        if (!pc.stage_rank) continue
        // Pull from combined scoreboard standings, then series, then stage —
        // first non-null target wins (admin UI enforces only one is set).
        const standings = pc.combined_scoreboard_id
          ? (combinedStandingsMap.get(pc.combined_scoreboard_id) ?? [])
          : pc.series_id
          ? (seriesStandingsMap.get(pc.series_id) ?? [])
          : pc.stage_id
          ? (stageStandingsMap.get(pc.stage_id) ?? [])
          : []
        if (standings.length === 0) continue
        const entry = standings[pc.stage_rank - 1]
        if (entry) rankBoard.push({ rank: pc.rank, teamId: entry.teamId, teamName: entry.teamName })
      }
      rankBoard.sort((a, b) => a.rank - b.rank)
    } else {
      const grandFinalStage = stagesList.find((s) => s.type === 'grand_final')
      if (grandFinalStage) {
        const standings = stageStandingsMap.get(grandFinalStage.id) ?? []
        standings.forEach((e, i) => rankBoard.push({ rank: i + 1, teamId: e.teamId, teamName: e.teamName }))
      }
    }
  } else {
    // Rank by accumulated stage prizes / WWCD bonuses — computed after wwcdBonusByTeamId is built
    // Placeholder: populated after wwcdBonusByTeamId is computed below
  }

  const prizeForStandings = prizeConfig.map((p) => ({
    rank: p.rank,
    prize: p.prize != null ? Number(p.prize) : null,
    pgs_points: p.pgs_points != null ? Number(p.pgs_points) : null,
    pgc_points: p.pgc_points != null ? Number(p.pgc_points) : null,
  }))

  const dropLocations: DropLocationRow[] = (dropLocData ?? []).map((d: AnyRow) => ({
    id: d.id,
    teamId: d.team_id,
    teamName: d.teams?.name ?? '?',
    logoUrl: d.teams?.logo_url ?? aliasLogoLookup[`${d.team_id}:`] ?? null,
    mapName: d.map_name,
    x: d.x,
    y: d.y,
  }))

  const mapKeys = [...mapsSet].sort()

  // WWCD bonus per linked team
  const wwcdRewards = (wwcdRewardsData ?? []) as AnyRow[]
  const wwcdBonusByTeamId: Record<string, { prize: number; pgs: number; pgc: number }> = {}
  if (wwcdRewards.length > 0) {
    for (const stage of stagesList) {
      if ((stage as AnyRow).include_in_total === false) continue
      for (const m of stage.matches) {
        if (m.status !== 'imported') continue
        for (const r of (resultsByMatch[m.id] ?? []) as AnyRow[]) {
          if ((r.placement as number) !== 1 || !r.team_id) continue
          const teamId = r.team_id as string
          for (const reward of wwcdRewards) {
            // Reward applies when its target matches this stage:
            //   stage_id set  → must equal current stage
            //   series_id set → current stage must belong to that series
            //   neither set   → applies to every imported match (legacy "all")
            if (reward.stage_id && reward.stage_id !== stage.id) continue
            if (reward.series_id && reward.series_id !== stage.series_id) continue
            const prizePerWwcd = reward.prize != null ? Number(reward.prize) : 0
            const pgsPerWwcd = reward.pgs_points ? Number(reward.pgs_points) : 0
            const pgcPerWwcd = reward.pgc_points ? Number(reward.pgc_points) : 0
            if (!wwcdBonusByTeamId[teamId]) wwcdBonusByTeamId[teamId] = { prize: 0, pgs: 0, pgc: 0 }
            wwcdBonusByTeamId[teamId].prize += prizePerWwcd
            wwcdBonusByTeamId[teamId].pgs += pgsPerWwcd
            wwcdBonusByTeamId[teamId].pgc += pgcPerWwcd
          }
        }
      }
    }
  }

  // Stage placement prizes → fold into bonus map
  const stagePrizeByStage: Record<string, { placement: number; prize: number | null; pgs: number | null; pgc: number | null }[]> = {}
  for (const row of (stagePrizeConfigData ?? []) as AnyRow[]) {
    if (!stagePrizeByStage[row.stage_id]) stagePrizeByStage[row.stage_id] = []
    stagePrizeByStage[row.stage_id].push({
      placement: row.placement as number,
      prize: row.prize != null ? Number(row.prize) : null,
      pgs: row.pgs_points != null ? Number(row.pgs_points) : null,
      pgc: row.pgc_points != null ? Number(row.pgc_points) : null,
    })
  }
  for (const stage of stagesList) {
    if ((stage as AnyRow).include_in_total === false) continue
    const stagePrizes = stagePrizeByStage[stage.id]
    if (!stagePrizes || stagePrizes.length === 0) continue
    const standings = stageStandingsMap.get(stage.id) ?? []
    for (let i = 0; i < standings.length; i++) {
      const entry = standings[i]
      if (!entry.teamId) continue
      const pc = stagePrizes.find((p) => p.placement === i + 1)
      if (!pc) continue
      if (!wwcdBonusByTeamId[entry.teamId]) wwcdBonusByTeamId[entry.teamId] = { prize: 0, pgs: 0, pgc: 0 }
      wwcdBonusByTeamId[entry.teamId].prize += pc.prize ?? 0
      wwcdBonusByTeamId[entry.teamId].pgs += pc.pgs ?? 0
      wwcdBonusByTeamId[entry.teamId].pgc += pc.pgc ?? 0
    }
  }

  // Series placement prizes → fold into bonus map (uses seriesStandingsMap built earlier)
  const seriesPrizeBySeries: Record<string, { placement: number; prize: number | null; pgs: number | null; pgc: number | null }[]> = {}
  for (const row of (seriesPrizeConfigData ?? []) as AnyRow[]) {
    if (!seriesPrizeBySeries[row.series_id]) seriesPrizeBySeries[row.series_id] = []
    seriesPrizeBySeries[row.series_id].push({
      placement: row.placement as number,
      prize: row.prize != null ? Number(row.prize) : null,
      pgs: row.pgs_points != null ? Number(row.pgs_points) : null,
      pgc: row.pgc_points != null ? Number(row.pgc_points) : null,
    })
  }
  for (const sr of seriesList) {
    const seriesPrizes = seriesPrizeBySeries[sr.id]
    if (!seriesPrizes || seriesPrizes.length === 0) continue
    const standings = seriesStandingsMap.get(sr.id) ?? []
    for (let i = 0; i < standings.length; i++) {
      const entry = standings[i]
      if (!entry.teamId) continue
      const pc = seriesPrizes.find((p) => p.placement === i + 1)
      if (!pc) continue
      if (!wwcdBonusByTeamId[entry.teamId]) wwcdBonusByTeamId[entry.teamId] = { prize: 0, pgs: 0, pgc: 0 }
      wwcdBonusByTeamId[entry.teamId].prize += pc.prize ?? 0
      wwcdBonusByTeamId[entry.teamId].pgs += pc.pgs ?? 0
      wwcdBonusByTeamId[entry.teamId].pgc += pc.pgc ?? 0
    }
  }

  // Special award prizes/points for teams → fold into bonus map
  for (const r of (specialAwardsData ?? []) as AnyRow[]) {
    const teamId = r.team_id as string | null
    if (!teamId) continue
    const prize = r.prize != null ? Number(r.prize) : 0
    const pgs = r.pgs_points != null ? Number(r.pgs_points) : 0
    const pgc = r.pgc_points != null ? Number(r.pgc_points) : 0
    if (prize === 0 && pgs === 0 && pgc === 0) continue
    if (!wwcdBonusByTeamId[teamId]) wwcdBonusByTeamId[teamId] = { prize: 0, pgs: 0, pgc: 0 }
    wwcdBonusByTeamId[teamId].prize += prize
    wwcdBonusByTeamId[teamId].pgs += pgs
    wwcdBonusByTeamId[teamId].pgc += pgc
  }

  // Prize/PGS/PGC ranking — build rankBoard now that wwcdBonusByTeamId is complete
  if (rankMethod !== 'stage') {
    // Cumulative per-stage point totals for tiebreakers
    const totalPtsByTeamId: Record<string, number> = {}
    const placePtsByTeamId: Record<string, number> = {}
    const killPtsByTeamId: Record<string, number> = {}
    for (const standings of stageStandingsMap.values()) {
      for (const e of standings) {
        if (!e.teamId) continue
        totalPtsByTeamId[e.teamId] = (totalPtsByTeamId[e.teamId] ?? 0) + e.totalPts
        placePtsByTeamId[e.teamId] = (placePtsByTeamId[e.teamId] ?? 0) + e.placePts
        killPtsByTeamId[e.teamId] = (killPtsByTeamId[e.teamId] ?? 0) + (e.totalPts - e.placePts)
      }
    }

    // Find the last imported match across all ON stages (by stage order, then match order)
    let lastMatchId: string | null = null
    for (let si = stagesList.length - 1; si >= 0; si--) {
      const stage = stagesList[si]
      if ((stage as AnyRow).include_in_total === false) continue
      const importedMatches = stage.matches
        .filter(m => m.status === 'imported')
        .sort((a, b) => b.order_num - a.order_num)
      if (importedMatches.length > 0) {
        lastMatchId = importedMatches[0].id
        break
      }
    }
    const lastMatchTotalPts: Record<string, number> = {}
    const lastMatchPlacement: Record<string, number> = {}
    if (lastMatchId) {
      const rule = matchToRule.get(lastMatchId) ?? ruleFromStage(null)
      for (const r of (resultsByMatch[lastMatchId] ?? []) as AnyRow[]) {
        const teamId = r.team_id as string | null
        if (!teamId) continue
        const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
        const kp = Math.round((r.total_kills ?? 0) * rule.kill_pts)
        lastMatchTotalPts[teamId] = pp + kp
        lastMatchPlacement[teamId] = r.placement ?? 99
      }
    }

    const seen = new Set<string>()
    const teamList: { teamId: string | null; teamName: string; total: number }[] = []
    for (const ts of teamStatsMap.values()) {
      const key = ts.teamId ?? `name:${ts.teamName}`
      if (seen.has(key)) continue
      seen.add(key)
      const bonus = ts.teamId ? (wwcdBonusByTeamId[ts.teamId] ?? null) : null
      const total = bonus
        ? rankMethod === 'prize' ? bonus.prize
          : rankMethod === 'pgs' ? bonus.pgs
          : bonus.pgc
        : 0
      teamList.push({ teamId: ts.teamId, teamName: ts.teamName, total })
    }
    teamList.sort((a, b) => {
      // 1순위: PGS/PGC 포인트 합계
      if (b.total !== a.total) return b.total - a.total
      // 2순위: 전체 스테이지 누적 total points
      const aTotalPts = a.teamId ? (totalPtsByTeamId[a.teamId] ?? 0) : 0
      const bTotalPts = b.teamId ? (totalPtsByTeamId[b.teamId] ?? 0) : 0
      if (bTotalPts !== aTotalPts) return bTotalPts - aTotalPts
      // 3순위: 전체 스테이지 누적 placement points
      const aPlacePts = a.teamId ? (placePtsByTeamId[a.teamId] ?? 0) : 0
      const bPlacePts = b.teamId ? (placePtsByTeamId[b.teamId] ?? 0) : 0
      if (bPlacePts !== aPlacePts) return bPlacePts - aPlacePts
      // 4순위: 전체 스테이지 누적 kill points
      const aKillPts = a.teamId ? (killPtsByTeamId[a.teamId] ?? 0) : 0
      const bKillPts = b.teamId ? (killPtsByTeamId[b.teamId] ?? 0) : 0
      if (bKillPts !== aKillPts) return bKillPts - aKillPts
      // 5순위: 마지막 매치 total points
      const aLastTotal = a.teamId ? (lastMatchTotalPts[a.teamId] ?? 0) : 0
      const bLastTotal = b.teamId ? (lastMatchTotalPts[b.teamId] ?? 0) : 0
      if (bLastTotal !== aLastTotal) return bLastTotal - aLastTotal
      // 6순위: 마지막 매치 생존 순위 (낮은 숫자 = 높은 순위)
      const aLastPlace = a.teamId ? (lastMatchPlacement[a.teamId] ?? 99) : 99
      const bLastPlace = b.teamId ? (lastMatchPlacement[b.teamId] ?? 99) : 99
      return aLastPlace - bLastPlace
    })
    teamList.forEach((e, i) => rankBoard.push({ rank: i + 1, teamId: e.teamId, teamName: e.teamName }))
  }

  // Make sure every DQ team appears in rankBoard so the UI's DQ section
  // renders them — even when stage_rank mapping skipped their position
  // or they got disqualified before accumulating any stats.
  {
    const presentTeamIds = new Set(rankBoard.filter((r) => r.teamId).map((r) => r.teamId as string))
    let synthRank = (rankBoard.length > 0 ? Math.max(...rankBoard.map((r) => r.rank)) : 0) + 1
    for (const r of (rosterTeamsData ?? []) as AnyRow[]) {
      if (!r.disqualified) continue
      const teamId = ((r.teams as AnyRow | null)?.id as string | null) ?? null
      if (!teamId || presentTeamIds.has(teamId)) continue
      const teamName = ((r.display_name as string | null) ?? ((r.teams as AnyRow | null)?.name as string | null)) ?? '?'
      rankBoard.push({ rank: synthRank++, teamId, teamName })
    }
  }

  // Special awards
  const playerIdToNickname = new Map<string, string>()
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (row.player_id && row.players?.nickname) playerIdToNickname.set(row.player_id as string, row.players.nickname as string)
  }

  interface SpecialAwardItem {
    id: string
    category: string | null
    awardName: string
    targetType: 'player' | 'team'
    playerId: string | null
    playerName: string | null
    teamId: string | null
    teamName: string | null
    teamLogoUrl: string | null
    prize: number | null
    pgsPoints: number | null
    pgcPoints: number | null
  }
  const specialAwardsList: SpecialAwardItem[] = (specialAwardsData ?? []).map((r: AnyRow) => {
    const teamId = (r.team_id as string | null) ?? null
    const teamRel = (r.teams as AnyRow | null) ?? null
    // tournament_teams.display_name takes precedence, then award's stored
    // team_display_name, then the team's current global name.
    const teamName = teamId
      ? (teamTournamentDisplayName.get(teamId) ?? (r.team_display_name as string | null) ?? (teamRel?.name as string | null) ?? null)
      : null
    return {
      id: r.id as string,
      category: ((r.category as string | null) ?? null) || null,
      awardName: r.award_name as string,
      targetType: (teamId ? 'team' : 'player') as 'player' | 'team',
      playerId: (r.player_id as string | null) ?? null,
      playerName: (r.player_display_name as string | null) ?? (r.player_id ? (playerIdToNickname.get(r.player_id as string) ?? null) : null) ?? ((r.players as AnyRow)?.nickname as string | null) ?? null,
      teamId,
      teamName,
      teamLogoUrl: (teamRel?.logo_url as string | null) ?? null,
      prize: r.prize != null ? Number(r.prize) : null,
      pgsPoints: r.pgs_points != null ? Number(r.pgs_points) : null,
      pgcPoints: r.pgc_points != null ? Number(r.pgc_points) : null,
    }
  })

  if (stagesList.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        No stage information available
      </div>
    )
  }

  return (
    <>
      <TournamentRoster roster={roster} />
      <TournamentDetailTabs
        stages={stagesList}
        series={seriesList}
        combined={combinedList.map((c) => ({ id: c.id, name: c.name, order_num: c.order_num, tab_order: c.tab_order, advance_count: c.advance_count ?? null, eliminate_count: c.eliminate_count ?? null, stageIds: [...c.stageIds] }))}
        combinedStandings={Object.fromEntries([...combinedStandingsMap.entries()])}
        seriesStandings={Object.fromEntries([...seriesStandingsMap.entries()])}
        resultsByMatch={resultsByMatch}
        damageByMatch={damageByMatch}
        rankBoard={rankBoard}
        prizeConfig={prizeForStandings}
        hasPrize={t.has_prize}
        hasPgsPoints={t.has_pgs_points}
        hasPgcPoints={t.has_pgc_points}
        currency={t.currency}
        aliasLogoLookup={aliasLogoLookup}
        stageAdditionalPts={stageAdditionalPts}
        wwcdBonusByTeamId={wwcdBonusByTeamId}
        specialAwards={specialAwardsList}
        playerStats={playerStats}
        stagePlayerStats={stagePlayerStats}
        seriesPlayerStats={seriesPlayerStats}
        playerStatsByMatch={playerStatsByMatch}
        teamStats={teamStats}
        dropLocations={dropLocations}
        mapKeys={mapKeys}
        stageTeamStats={stageTeamStats}
        seriesTeamStats={seriesTeamStats}
        dqTeamIds={[...dqTeamIds]}
      />
    </>
  )
}
