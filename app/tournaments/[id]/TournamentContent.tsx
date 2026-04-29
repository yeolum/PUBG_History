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

function resolveLogoUrl(teamId: string | null, name: string, lookup: Record<string, string | null>): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

export default async function TournamentContent({ id, tournament }: { id: string; tournament: Tournament }) {
  const supabase = createPublicClient()
  const t = tournament

  // Fire alias/lookup queries immediately — they don't depend on match IDs,
  // so they run in parallel with Round 1 instead of waiting for Round 2.
  const aliasQueriesPromise = Promise.all([
    supabase.from('team_aliases').select('team_id, alias, logo_url'),
    supabase.from('team_drop_locations').select('id, team_id, map_name, x, y, teams(name, logo_url)').eq('tournament_id', id),
    supabase.from('player_aliases').select('alias, player_id'),
  ])

  // Round 1: stages, prize config, series (parallel with alias queries above)
  const [{ data: stagesData }, { data: prizeConfigData }, { data: seriesData }] = await Promise.all([
    supabase.from('stages').select('*, scoring_rules(*), matches(*)').eq('tournament_id', id).order('order_num'),
    supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, stage_rank').eq('tournament_id', id).order('rank'),
    supabase.from('series').select('*').eq('tournament_id', id).order('order_num'),
  ])

  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]
  const prizeConfig = (prizeConfigData ?? []) as TournamentPrizeConfig[]
  const seriesList = (seriesData ?? []) as Series[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsByMatch: Record<string, any[]> = {}
  const damageByMatch: Record<string, { placement: number; damage_dealt: number }[]> = {}
  const playerStatsMap = new Map<string, PlayerStatRow>()
  const mapsSet = new Set<string>()

  const allImportedMatchIds: string[] = []
  const matchToRule = new Map<string, ReturnType<typeof ruleFromStage>>()
  for (const stage of stagesList) {
    const rule = ruleFromStage(stage.scoring_rules)
    for (const m of stage.matches) {
      matchToRule.set(m.id, rule)
      if (m.status === 'imported') {
        allImportedMatchIds.push(m.id)
        if (m.map) mapsSet.add(m.map)
      }
    }
  }

  // Round 2: fetch all match data in parallel
  const PS_SELECT = 'match_id, player_id, team_id, pubg_player_name, display_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, placement, players(id, nickname, nationality_code), teams(id, name, short_name, logo_url)'
  const TR_SELECT = '*, teams(id, name, short_name, logo_url)'
  const PAGE = 1000

  async function fetchAllPages(table: string, select: string, matchIds: string[]): Promise<AnyRow[]> {
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

  // Round 2: match data + alias queries (likely already done from above)
  const [trData, psData, [{ data: allAliasData }, { data: dropLocData }, { data: playerAliasData }]] = await Promise.all([
    allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages('match_team_results', TR_SELECT, allImportedMatchIds),
    allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages('match_player_stats', PS_SELECT, allImportedMatchIds),
    aliasQueriesPromise,
  ])

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

  // Build damageByMatch + playerStatsMap + playerStatsByMatch
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
    const teamName = row.teams?.name ?? row.pubg_player_name?.split('_')[0] ?? '?'
    const logoUrl = row.teams?.logo_url ?? null

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

  // Build alias logo lookup
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

  const aliasToTeamId = new Map<string, string>()
  const aliasTagToName = new Map<string, string>()
  for (const a of allAliasData ?? []) {
    const row = a as AnyRow
    aliasToTeamId.set(row.alias.toLowerCase(), row.team_id)
    const dashIdx = (row.alias as string).indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = row.alias.slice(0, dashIdx).trim().toLowerCase()
      const namePart = row.alias.slice(dashIdx + 3).trim()
      if (tagPart && !aliasToTeamId.has(tagPart)) aliasToTeamId.set(tagPart, row.team_id)
      if (tagPart && namePart && !aliasTagToName.has(tagPart)) aliasTagToName.set(tagPart, namePart)
      if (namePart) aliasTagToName.set(row.alias.toLowerCase(), namePart)
    }
  }

  function resolveTeamName(pubgName: string | null, teamsName: string | null, displayName: string | null): string {
    if (displayName) return displayName
    const key = (pubgName ?? '').toLowerCase()
    return aliasTagToName.get(key) ?? teamsName ?? stripTagPrefix(pubgName ?? '?')
  }

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
  const teamStats: TeamStatRow[] = [...teamStatsMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)

  const playerStats: PlayerStatRow[] = [...playerStatsMap.values()].sort((a, b) => b.kills - a.kills)

  // Build roster
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
  const roster = [...teamRosterMap.entries()]
    .map(([teamId, team]) => ({
      id: teamId, name: team.name, logo_url: team.logo_url,
      players: [...team.players.values()].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Per-stage standings → rank board
  type StandingsEntry = { teamId: string | null; teamName: string }
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
    stageStandingsMap.set(stage.id, [...ptsMap.values()].sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts))
  }

  type RankEntry = { teamId: string | null; teamName: string; rank: number }
  const rankBoard: RankEntry[] = []
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

  const prizeForStandings = prizeConfig.map((p) => ({
    rank: p.rank, prize: p.prize, pgs_points: p.pgs_points, pgc_points: p.pgc_points,
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
        aliasLogoLookup={aliasLogoLookup}
        playerStats={playerStats}
        playerStatsByMatch={playerStatsByMatch}
        teamStats={teamStats}
        dropLocations={dropLocations}
        mapKeys={mapKeys}
      />
    </>
  )
}
