import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/server'
import type { Tournament, Stage, Match, TournamentPrizeConfig, Series } from '@/lib/types'
import { calcPlacementPtsWithRule, ruleFromStage } from '@/lib/scoring'
import { stripTagPrefix } from '@/lib/pubg-api'
import TournamentRoster from './TournamentRoster'
import TournamentDetailTabs from './TournamentDetailTabs'
import type { PlayerStatRow, PlayerMatchStat } from './PlayerStatsTable'
import type { TeamStatRow, DropLocationRow } from './TeamStatsTable'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const PS_SELECT = 'match_id, player_id, team_id, pubg_player_name, display_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, placement, players(id, nickname, nationality_code), teams(id, name, short_name, logo_url)'
const TR_SELECT = '*, teams(id, name, short_name, logo_url)'
const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(supabase: ReturnType<typeof createPublicClient>, table: string, select: string, matchIds: string[]): Promise<AnyRow[]> {
  const rows: AnyRow[] = []
  let page = 0
  while (true) {
    const { data: batch } = await supabase
      .from(table)
      .select(select)
      .in('match_id', matchIds)
      .order('id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as AnyRow[]))
    if (batch.length < PAGE) break
    page++
  }
  return rows
}

// Caches all heavy DB fetching in Node.js process memory (dev + prod).
// First load: hits DB. Subsequent loads within 30s: returns cached result instantly.
const loadTournamentData = unstable_cache(
  async (id: string) => {
    const supabase = createPublicClient()

    const aliasQueriesPromise = Promise.all([
      supabase.from('team_aliases').select('team_id, alias, logo_url'),
      supabase.from('team_drop_locations').select('id, team_id, map_name, x, y, teams(name, logo_url)').eq('tournament_id', id),
      supabase.from('player_aliases').select('alias, player_id'),
    ])

    const [{ data: stagesData }, { data: prizeConfigData }, { data: seriesData }] = await Promise.all([
      supabase.from('stages').select('*, scoring_rules(*), matches(*)').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, stage_rank').eq('tournament_id', id).order('rank'),
      supabase.from('series').select('*').eq('tournament_id', id).order('order_num'),
    ])

    const allImportedMatchIds: string[] = []
    for (const stage of (stagesData ?? []) as AnyRow[]) {
      for (const m of (stage.matches ?? []) as AnyRow[]) {
        if (m.status === 'imported') allImportedMatchIds.push(m.id as string)
      }
    }

    const stageIds = (stagesData ?? []).map((s: AnyRow) => s.id as string)

    const seriesIds = (seriesData ?? []).map((sr: AnyRow) => sr.id as string)

    const [trData, psData, [{ data: allAliasData }, { data: dropLocData }, { data: playerAliasData }], { data: additionalPtsData }, { data: wwcdRewardsData }, { data: specialAwardsData }, { data: stagePrizeConfigData }, { data: seriesPrizeConfigData }, { data: rosterTeamsData }, { data: rosterPlayersData }] = await Promise.all([
      allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages(supabase, 'match_team_results', TR_SELECT, allImportedMatchIds),
      allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages(supabase, 'match_player_stats', PS_SELECT, allImportedMatchIds),
      aliasQueriesPromise,
      stageIds.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('stage_additional_points').select('stage_id, team_name, points').in('stage_id', stageIds),
      supabase.from('tournament_wwcd_rewards').select('*').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_special_awards').select('*, players(id, nickname)').eq('tournament_id', id).order('order_num'),
      stageIds.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('stage_prize_config').select('stage_id, placement, prize, pgs_points, pgc_points').in('stage_id', stageIds),
      seriesIds.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('stage_prize_config').select('series_id, placement, prize, pgs_points, pgc_points').in('series_id', seriesIds),
      supabase.from('tournament_teams').select('team_id, teams(id, name, short_name, logo_url)').eq('tournament_id', id),
      supabase.from('tournament_players').select('player_id, team_id, players(id, nickname, nationality_code)').eq('tournament_id', id),
    ])

    return { stagesData, prizeConfigData, seriesData, trData, psData, allAliasData, dropLocData, playerAliasData, additionalPtsData, wwcdRewardsData, specialAwardsData, stagePrizeConfigData, seriesPrizeConfigData, rosterTeamsData, rosterPlayersData }
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

  const { stagesData, prizeConfigData, seriesData, trData, psData, allAliasData, dropLocData, playerAliasData, additionalPtsData, wwcdRewardsData, specialAwardsData, stagePrizeConfigData, seriesPrizeConfigData, rosterTeamsData, rosterPlayersData } = await loadTournamentData(id)

  // stageId → { teamNameLower → extraPts }
  const stageAdditionalPts: Record<string, Record<string, number>> = {}
  for (const ap of (additionalPtsData ?? []) as AnyRow[]) {
    if (!stageAdditionalPts[ap.stage_id]) stageAdditionalPts[ap.stage_id] = {}
    stageAdditionalPts[ap.stage_id][(ap.team_name as string).toLowerCase()] = Number(ap.points)
  }

  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]
  const prizeConfig = (prizeConfigData ?? []) as TournamentPrizeConfig[]
  const seriesList = (seriesData ?? []) as Series[]

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

  // Build pubg name → player_id lookup from aliases
  const pubgNameToPlayerId = new Map<string, string>()
  for (const a of playerAliasData ?? []) {
    const row = a as AnyRow
    pubgNameToPlayerId.set((row.alias as string).toLowerCase(), row.player_id as string)
  }

  // Build resultsByMatch from team results
  for (const r of trData ?? []) {
    const row = r as AnyRow
    if (!resultsByMatch[row.match_id]) resultsByMatch[row.match_id] = []
    resultsByMatch[row.match_id].push(row)
  }

  // Build pubg_player_name → player_id from stats that ARE linked within this tournament
  const nameToPlayerIdLocal = new Map<string, string>()
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (row.player_id && row.pubg_player_name) {
      nameToPlayerIdLocal.set((row.pubg_player_name as string).toLowerCase(), row.player_id as string)
    }
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

  function resolveTeamName(pubgName: string | null, teamsName: string | null, displayName: string | null): string {
    if (displayName) return displayName
    const key = (pubgName ?? '').toLowerCase()
    return aliasTagToName.get(key) ?? teamsName ?? stripTagPrefix(pubgName ?? '?')
  }

  // Assign _resolvedName on team results (must be before player stats building)
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      r._resolvedName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name)
    }
  }

  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || !r.pubg_team_name) continue
      const aliasLogo = aliasLogoLookup[`${effectiveId}:${r.pubg_team_name}`]
      if (!aliasLogo) continue
      const displayedName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name)
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

    const resolvedPlayerId: string | null =
      row.player_id ??
      nameToPlayerIdLocal.get((row.pubg_player_name as string | null ?? '').toLowerCase()) ??
      pubgNameToPlayerId.get((row.pubg_player_name as string | null ?? '').toLowerCase()) ??
      null

    const nickname = row.display_name ?? row.players?.nickname ?? row.pubg_player_name ?? '?'
    const pubgPlayerName: string = row.pubg_player_name ?? ''
    // Resolve team name from match_team_results (same as participant display) instead of current DB name
    const matchTeamResult = row.team_id
      ? (resultsByMatch[row.match_id] ?? []).find((r: AnyRow) => r.team_id === row.team_id)
      : null
    const teamName = matchTeamResult?._resolvedName ?? row.teams?.name ?? stripTagPrefix(row.pubg_player_name?.split('_')[0] ?? '?')
    const logoUrl = row.team_id ? resolveLogoUrl(row.team_id, teamName, aliasLogoLookup) : null

    const key = resolvedPlayerId ?? `pubg:${pubgPlayerName}`
    if (!playerStatsMap.has(key)) {
      playerStatsMap.set(key, {
        playerId: resolvedPlayerId,
        nickname,
        teamId: row.team_id ?? null,
        teamName,
        logoUrl,
        games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0,
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
      placement: row.placement ?? null,
    })
  }

  // Build team stats
  const teamStatsMap = new Map<string, TeamStatRow>()
  for (const [matchId, rows] of Object.entries(resultsByMatch)) {
    const rule = matchToRule.get(matchId) ?? ruleFromStage(null)
    for (const r of rows as AnyRow[]) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      if (!teamStatsMap.has(key)) {
        const tName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name)
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
  const teamRosterMap = new Map<string, { name: string; logo_url: string | null; players: Map<string, { id: string; nickname: string; nationality: string | null }> }>()
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || teamRosterMap.has(effectiveId)) continue
      const displayName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name)
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
      })
    }
  }

  // Union the pre-registered tournament roster — registered teams / players
  // should always show, even if no match has been imported yet or auto-link
  // failed during import.
  for (const r of (rosterTeamsData ?? []) as AnyRow[]) {
    const t = r.teams as AnyRow | null
    if (!t?.id) continue
    const teamId = t.id as string
    const tName = (t.name as string) ?? '?'
    const logoUrl = (t.logo_url as string | null) ?? aliasLogoLookup[`${teamId}:`] ?? null
    if (!teamRosterMap.has(teamId)) {
      teamRosterMap.set(teamId, { name: tName, logo_url: logoUrl, players: new Map() })
    }
    if (!teamStatsMap.has(teamId)) {
      teamStatsMap.set(teamId, {
        teamId, teamName: tName, logoUrl,
        games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
      })
    }
  }
  for (const r of (rosterPlayersData ?? []) as AnyRow[]) {
    const p = r.players as AnyRow | null
    if (!p?.id) continue
    const playerId = p.id as string
    const nickname = (p.nickname as string) ?? '?'
    const nationality = (p.nationality_code as string | null) ?? null
    // Use the tournament-scoped team, NOT the player's global team_id, so a player
    // who was registered as DN here doesn't get cross-listed under GEN just because
    // their global profile says GEN.
    const tournamentTeamId = (r.team_id as string | null) ?? null

    if (tournamentTeamId) {
      const team = teamRosterMap.get(tournamentTeamId)
      if (team && !team.players.has(playerId)) {
        team.players.set(playerId, { id: playerId, nickname, nationality })
      }
    }
    if (!playerStatsMap.has(playerId)) {
      const team = tournamentTeamId ? teamStatsMap.get(tournamentTeamId) : null
      playerStatsMap.set(playerId, {
        playerId,
        nickname,
        teamId: tournamentTeamId,
        teamName: team?.teamName ?? '',
        logoUrl: team?.logoUrl ?? null,
        games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0,
      })
    }
  }

  const teamStats: TeamStatRow[] = [...teamStatsMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)
  const playerStats: PlayerStatRow[] = [...playerStatsMap.values()].sort((a, b) => b.kills - a.kills)

  const roster = [...teamRosterMap.entries()]
    .map(([teamId, team]) => ({
      id: teamId, name: team.name, logo_url: team.logo_url,
      players: [...team.players.values()].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Per-stage standings → rank board
  type StandingsEntry = { teamId: string | null; teamName: string; placePts: number }
  const stageStandingsMap = new Map<string, StandingsEntry[]>()
  for (const stage of stagesList) {
    const ptsMap = new Map<string, { teamId: string | null; teamName: string; totalPts: number; placePts: number }>()
    for (const m of stage.matches) {
      if (m.status !== 'imported') continue
      for (const r of resultsByMatch[m.id] ?? []) {
        const row = r as AnyRow
        const key = row.team_id ?? `pubg:${row.pubg_team_name ?? ''}`
        if (!ptsMap.has(key)) {
          ptsMap.set(key, { teamId: row.team_id ?? null, teamName: resolveTeamName(row.pubg_team_name, row.teams?.name ?? null, row.display_name), totalPts: 0, placePts: 0 })
        }
        const e = ptsMap.get(key)!
        const matchRule = matchToRule.get(m.id) ?? ruleFromStage(null)
        const pp = calcPlacementPtsWithRule(row.placement ?? 99, matchRule)
        e.totalPts += pp + Math.round((row.total_kills ?? 0) * matchRule.kill_pts)
        e.placePts += pp
      }
    }
    const extraForStage = stageAdditionalPts[stage.id] ?? {}
    for (const e of ptsMap.values()) {
      e.totalPts += extraForStage[e.teamName.toLowerCase()] ?? 0
    }
    stageStandingsMap.set(stage.id, [...ptsMap.values()].sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts))
  }

  type RankEntry = { teamId: string | null; teamName: string; rank: number }
  const rankBoard: RankEntry[] = []
  const rankMethod = (t.ranking_method ?? 'stage') as 'stage' | 'prize' | 'pgs' | 'pgc'

  if (rankMethod === 'stage') {
    const hasStageMapping = prizeConfig.some((p) => p.stage_id != null && p.stage_rank != null)
    if (hasStageMapping) {
      for (const pc of prizeConfig) {
        if (!pc.stage_id || !pc.stage_rank) continue
        const standings = stageStandingsMap.get(pc.stage_id) ?? []
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
      for (const m of stage.matches) {
        if (m.status !== 'imported') continue
        for (const r of (resultsByMatch[m.id] ?? []) as AnyRow[]) {
          if ((r.placement as number) !== 1 || !r.team_id) continue
          const teamId = r.team_id as string
          for (const reward of wwcdRewards) {
            if (reward.stage_id && reward.stage_id !== stage.id) continue
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

  // Series cumulative standings (used for both display and series-prize folding)
  type SeriesStandingEntry = { teamId: string | null; teamName: string; matches: number; wwcd: number; placePts: number; killPts: number; totalPts: number }
  const seriesStandingsMap = new Map<string, SeriesStandingEntry[]>()
  for (const sr of seriesList) {
    const seriesStages = stagesList.filter((s) => s.series_id === sr.id)
    if (seriesStages.length === 0) continue
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
              matches: 0, wwcd: 0, placePts: 0, killPts: 0, totalPts: 0,
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
        }
      }
      const extraForStage = stageAdditionalPts[stage.id] ?? {}
      for (const e of ptsMap.values()) {
        const extra = extraForStage[e.teamName.toLowerCase()] ?? 0
        e.totalPts += extra
      }
    }
    seriesStandingsMap.set(sr.id, [...ptsMap.values()].sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts))
  }

  // Series placement prizes → fold into bonus map
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

  // Prize/PGS/PGC ranking — build rankBoard now that wwcdBonusByTeamId is complete
  if (rankMethod !== 'stage') {
    // Tiebreaker (SUPER v2): sum of placement pts across all stages
    const placePtsByTeamId: Record<string, number> = {}
    for (const standings of stageStandingsMap.values()) {
      for (const e of standings) {
        if (!e.teamId) continue
        placePtsByTeamId[e.teamId] = (placePtsByTeamId[e.teamId] ?? 0) + e.placePts
      }
    }

    const seen = new Set<string>()
    const teamList: { teamId: string | null; teamName: string; total: number; placePts: number }[] = []
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
      const placePts = ts.teamId ? (placePtsByTeamId[ts.teamId] ?? 0) : 0
      teamList.push({ teamId: ts.teamId, teamName: ts.teamName, total, placePts })
    }
    teamList.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return b.placePts - a.placePts  // SUPER v2: placement pts tiebreaker
    })
    teamList.forEach((e, i) => rankBoard.push({ rank: i + 1, teamId: e.teamId, teamName: e.teamName }))
  }

  // Special awards
  const playerIdToNickname = new Map<string, string>()
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (row.player_id && row.players?.nickname) playerIdToNickname.set(row.player_id as string, row.players.nickname as string)
  }

  interface SpecialAwardItem {
    id: string; awardName: string; playerId: string | null; playerName: string | null
    prize: number | null; pgsPoints: number | null; pgcPoints: number | null
  }
  const specialAwardsList: SpecialAwardItem[] = (specialAwardsData ?? []).map((r: AnyRow) => ({
    id: r.id as string,
    awardName: r.award_name as string,
    playerId: (r.player_id as string | null) ?? null,
    playerName: (r.player_display_name as string | null) ?? (r.player_id ? (playerIdToNickname.get(r.player_id as string) ?? null) : null) ?? ((r.players as AnyRow)?.nickname as string | null) ?? null,
    prize: r.prize != null ? Number(r.prize) : null,
    pgsPoints: r.pgs_points != null ? Number(r.pgs_points) : null,
    pgcPoints: r.pgc_points != null ? Number(r.pgc_points) : null,
  }))

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
        playerStatsByMatch={playerStatsByMatch}
        teamStats={teamStats}
        dropLocations={dropLocations}
        mapKeys={mapKeys}
      />
    </>
  )
}
