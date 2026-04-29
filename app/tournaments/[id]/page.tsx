import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Stage, Match, TournamentPrizeConfig, Series } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import { getMapDisplayName, stripTagPrefix } from '@/lib/pubg-api'
import TournamentRoster from './TournamentRoster'
import TournamentDetailTabs from './TournamentDetailTabs'
import type { PlayerStatRow, PlayerMatchStat } from './PlayerStatsTable'
import type { TeamStatRow, DropLocationRow } from './TeamStatsTable'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.from('tournaments').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Tournament' }
}

const STATUS_LABEL: Record<string, string> = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

function resolveLogoUrl(teamId: string | null, name: string, lookup: Record<string, string | null>): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createPublicClient()

  const [{ data: tournament }, { data: stagesData }, { data: prizeConfigData }, { data: seriesData }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase.from('stages').select('*, matches(*)').eq('tournament_id', id).order('order_num'),
    supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, stage_rank').eq('tournament_id', id).order('rank'),
    supabase.from('series').select('*').eq('tournament_id', id).order('order_num'),
  ])

  if (!tournament) notFound()
  const t = tournament as Tournament
  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]
  const prizeConfig = (prizeConfigData ?? []) as TournamentPrizeConfig[]
  const seriesList = (seriesData ?? []) as Series[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsByMatch: Record<string, any[]> = {}
  const damageByMatch: Record<string, { placement: number; damage_dealt: number }[]> = {}
  const playerStatsMap = new Map<string, PlayerStatRow>()
  const mapsSet = new Set<string>()

  const allImportedMatchIds: string[] = []
  for (const stage of stagesList) {
    for (const m of stage.matches) {
      if (m.status === 'imported') {
        allImportedMatchIds.push(m.id)
        if (m.map) mapsSet.add(m.map)
      }
    }
  }

  // Round 2: fetch all data in parallel using match IDs
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
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (!batch || batch.length === 0) break
      rows.push(...(batch as AnyRow[]))
      if (batch.length < PAGE) break
      page++
    }
    return rows
  }

  const [trData, psData, [{ data: allAliasData }, { data: dropLocData }, { data: playerAliasData }]] = await Promise.all([
    allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages('match_team_results', TR_SELECT, allImportedMatchIds),
    allImportedMatchIds.length === 0 ? Promise.resolve([]) : fetchAllPages('match_player_stats', PS_SELECT, allImportedMatchIds),
    Promise.all([
      supabase.from('team_aliases').select('team_id, alias, logo_url'),
      supabase.from('team_drop_locations').select('id, team_id, map_name, x, y, teams(name, logo_url)').eq('tournament_id', id),
      supabase.from('player_aliases').select('alias, player_id'),
    ]),
  ])

  // Build pubg name → player_id lookup from aliases (for resolving unlinked stats)
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

  // Build pubg_player_name → player_id from stats that ARE linked within this tournament's own data.
  // This self-heals unlinked stats without needing external aliases.
  const nameToPlayerIdLocal = new Map<string, string>()
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (row.player_id && row.pubg_player_name) {
      nameToPlayerIdLocal.set((row.pubg_player_name as string).toLowerCase(), row.player_id as string)
    }
  }

  // Build damageByMatch + playerStatsMap + playerStatsByMatch from player stats
  const playerStatsByMatch: Record<string, PlayerMatchStat[]> = {}
  for (const d of psData ?? []) {
    const row = d as AnyRow
    if (!damageByMatch[row.match_id]) damageByMatch[row.match_id] = []
    damageByMatch[row.match_id].push({ placement: row.placement, damage_dealt: Number(row.damage_dealt ?? 0) })

    // Resolve player_id: prefer directly linked, then local tournament data, then player_aliases
    const resolvedPlayerId: string | null =
      row.player_id ??
      nameToPlayerIdLocal.get((row.pubg_player_name as string | null ?? '').toLowerCase()) ??
      pubgNameToPlayerId.get((row.pubg_player_name as string | null ?? '').toLowerCase()) ??
      null

    const nickname = row.display_name ?? row.players?.nickname ?? row.pubg_player_name ?? '?'
    const teamName = row.teams?.name ?? row.pubg_player_name?.split('_')[0] ?? '?'
    const logoUrl = row.teams?.logo_url ?? null

    const key = resolvedPlayerId ?? `pubg:${row.pubg_player_name ?? ''}`
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

    if (!playerStatsByMatch[row.match_id]) playerStatsByMatch[row.match_id] = []
    playerStatsByMatch[row.match_id].push({
      playerId: resolvedPlayerId,
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
    // "TAG - Name" 형식이면 TAG 단독으로도 인덱싱 (PUBG 매치의 pubg_team_name이 TAG만 오는 경우 대비)
    const dashIdx = (row.alias as string).indexOf(' - ')
    if (dashIdx !== -1) {
      const tagPart = (row.alias as string).slice(0, dashIdx).trim()
      if (tagPart) aliasLogoLookup[`${row.team_id}:${tagPart}`] = row.logo_url
    }
  }

  const aliasToTeamId = new Map<string, string>()
  // aliasTagToName: tag part (lowercase) → name part  e.g. "gen" → "Gen.G"
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
      // Also index by full alias (lowercase) → name part
      if (namePart) aliasTagToName.set(row.alias.toLowerCase(), namePart)
    }
  }

  // Helper: resolve display name — alias name part takes priority over teams.name
  function resolveTeamName(pubgName: string | null, teamsName: string | null, displayName: string | null): string {
    const key = (pubgName ?? '').toLowerCase()
    return aliasTagToName.get(key) ?? teamsName ?? stripTagPrefix(displayName ?? pubgName ?? '?')
  }

  // Pre-stamp _resolvedName on every result row so client components can use it directly
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
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      if (!teamStatsMap.has(key)) {
        const teamName = resolveTeamName(r.pubg_team_name, r.teams?.name ?? null, r.display_name)
        teamStatsMap.set(key, {
          teamId: r.team_id ?? null,
          teamName,
          logoUrl: resolveLogoUrl(r.team_id, teamName, aliasLogoLookup),
          games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
        })
      }
      const e = teamStatsMap.get(key)!
      e.games++
      if (r.placement === 1) e.wwcd++
      e.totalKills += r.total_kills ?? 0
      e.totalDamage += Number(r.total_damage ?? 0)
      e.totalPoints += calcPlacementPts(r.placement ?? 99) + (r.total_kills ?? 0)
      if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
    }
  }
  const teamStats: TeamStatRow[] = [...teamStatsMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)

  // Player stats array (sorted by kills)
  const playerStats: PlayerStatRow[] = [...playerStatsMap.values()].sort((a, b) => b.kills - a.kills)

  // Build roster from already-fetched psData (reuse, no extra query)
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
        const pp = calcPlacementPts(row.placement ?? 99)
        e.totalPts += pp + (row.total_kills ?? 0)
        e.placePts += pp
      }
    }
    const sorted = [...ptsMap.values()].sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
    stageStandingsMap.set(stage.id, sorted)
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

  // Drop locations (already fetched in round 2)
  const dropLocations: DropLocationRow[] = (dropLocData ?? []).map((d: AnyRow) => ({
    id: d.id,
    teamId: d.team_id,
    teamName: d.teams?.name ?? '?',
    logoUrl: d.teams?.logo_url ?? aliasLogoLookup[`${d.team_id}:`] ?? null,
    mapName: d.map_name,
    x: d.x,
    y: d.y,
  }))

  // Map keys used in this tournament (from match data)
  const mapKeys = [...mapsSet].sort()
  void getMapDisplayName // imported above, used in TeamStatsTable

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-10 w-full">
        {/* Tournament header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← Tournaments</Link>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{t.name}</h1>
            {t.short_name && (
              <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-500">{t.short_name}</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              t.status === 'ongoing' ? 'bg-green-100 text-green-700' :
              t.status === 'upcoming' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>{STATUS_LABEL[t.status]}</span>
          </div>
          {t.region && <p className="text-sm text-gray-500">{t.region}</p>}
          {(t.start_date || t.end_date) && (
            <p className="text-sm text-gray-400 mt-0.5">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
          )}
          {t.prize_pool && <p className="text-base font-semibold text-yellow-600 mt-0.5">{t.prize_pool}</p>}
          {t.description && <p className="text-sm text-gray-600 mt-1">{t.description}</p>}
        </div>

        {/* Participant roster */}
        <TournamentRoster roster={roster} />

        {/* Tabs: Scoreboard | Player Data | Team Data */}
        {stagesList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            No stage information available
          </div>
        ) : (
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
        )}
      </main>
    </>
  )
}
