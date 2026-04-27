import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Stage, Match, TournamentPrizeConfig, Series } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import { getMapDisplayName } from '@/lib/pubg-api'
import TournamentRoster from './TournamentRoster'
import TournamentDetailTabs from './TournamentDetailTabs'
import type { PlayerStatRow } from './PlayerStatsTable'
import type { TeamStatRow, DropLocationRow } from './TeamStatsTable'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
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
  const supabase = await createClient()

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

  // Collect all imported matches upfront
  const allImportedMatches: { id: string; map: string | null }[] = []
  for (const stage of stagesList) {
    for (const m of stage.matches) {
      if (m.status === 'imported') {
        allImportedMatches.push({ id: m.id, map: m.map })
        if (m.map) mapsSet.add(m.map)
      }
    }
  }

  // Step 1: match_team_results per-stage (16 rows/match → safe with stage batching)
  await Promise.all(
    stagesList.map(async (stage) => {
      const stageMatchIds = stage.matches
        .filter((m) => m.status === 'imported')
        .map((m) => m.id)
      if (stageMatchIds.length === 0) return
      const { data: trData } = await supabase
        .from('match_team_results')
        .select('*, teams(id, name, short_name, logo_url)')
        .in('match_id', stageMatchIds)
        .order('placement')
      for (const r of trData ?? []) {
        const row = r as AnyRow
        if (!resultsByMatch[row.match_id]) resultsByMatch[row.match_id] = []
        resultsByMatch[row.match_id].push(row)
      }
    })
  )

  // Step 2: match_player_stats per-match (max ~64 rows/match → never hits 1000-row limit)
  // Batch 20 matches per round to avoid excessive simultaneous connections
  const PLAYER_BATCH = 20
  for (let i = 0; i < allImportedMatches.length; i += PLAYER_BATCH) {
    const batch = allImportedMatches.slice(i, i + PLAYER_BATCH)
    await Promise.all(
      batch.map(async (match) => {
        const { data: pdData } = await supabase
          .from('match_player_stats')
          .select('match_id, player_id, team_id, pubg_player_name, display_name, kills, assists, knocks, headshot_kills, damage_dealt, survival_time, placement, players(id, nickname), teams(id, name, short_name, logo_url)')
          .eq('match_id', match.id)

        for (const d of pdData ?? []) {
          const row = d as AnyRow

          // damageByMatch
          if (!damageByMatch[row.match_id]) damageByMatch[row.match_id] = []
          damageByMatch[row.match_id].push({ placement: row.placement, damage_dealt: Number(row.damage_dealt ?? 0) })

          // Player stats aggregation
          const key = row.player_id ?? `pubg:${row.pubg_player_name ?? ''}`
          if (!playerStatsMap.has(key)) {
            playerStatsMap.set(key, {
              playerId: row.player_id ?? null,
              nickname: row.display_name ?? row.players?.nickname ?? row.pubg_player_name ?? '?',
              teamId: row.team_id ?? null,
              teamName: row.teams?.name ?? row.pubg_player_name?.split('_')[0] ?? '?',
              logoUrl: row.teams?.logo_url ?? null,
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
        }
      })
    )
  }

  // Build alias logo lookup: `${teamId}:displayName` → alias logo, `${teamId}:` → main logo
  const aliasLogoLookup: Record<string, string | null> = {}
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      if (r.team_id && r.teams?.logo_url) {
        const mainKey = `${r.team_id}:`
        if (!(mainKey in aliasLogoLookup)) aliasLogoLookup[mainKey] = r.teams.logo_url
      }
    }
  }
  const { data: allAliasData } = await supabase
    .from('team_aliases')
    .select('team_id, alias, logo_url')
  for (const a of allAliasData ?? []) {
    const row = a as AnyRow
    if (row.logo_url) aliasLogoLookup[`${row.team_id}:${row.alias}`] = row.logo_url
  }

  const aliasToTeamId = new Map<string, string>()
  for (const a of allAliasData ?? []) {
    aliasToTeamId.set((a as AnyRow).alias.toLowerCase(), (a as AnyRow).team_id)
  }

  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || !r.pubg_team_name) continue
      const aliasLogo = aliasLogoLookup[`${effectiveId}:${r.pubg_team_name}`]
      if (!aliasLogo) continue
      const displayedName = r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? ''
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
        const teamName = r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '?'
        teamStatsMap.set(key, {
          teamId: r.team_id ?? null,
          teamName,
          logoUrl: resolveLogoUrl(r.team_id, teamName, aliasLogoLookup),
          games: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
        })
      }
      const e = teamStatsMap.get(key)!
      e.games++
      e.totalKills += r.total_kills ?? 0
      e.totalDamage += Number(r.total_damage ?? 0)
      e.totalPoints += calcPlacementPts(r.placement ?? 99) + (r.total_kills ?? 0)
      if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
    }
  }
  const teamStats: TeamStatRow[] = [...teamStatsMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)

  // Player stats array (sorted by kills)
  const playerStats: PlayerStatRow[] = [...playerStatsMap.values()].sort((a, b) => b.kills - a.kills)

  // Roster query
  const allImportedMatchIds = stagesList.flatMap((s) =>
    s.matches.filter((m) => m.status === 'imported').map((m) => m.id)
  )
  const { data: rosterPlayerData } = allImportedMatchIds.length > 0
    ? await supabase
        .from('match_player_stats')
        .select('team_id, player_id, players(id, nickname, nationality)')
        .in('match_id', allImportedMatchIds)
        .not('team_id', 'is', null)
        .not('player_id', 'is', null)
    : { data: [] }

  const teamRosterMap = new Map<string, { name: string; logo_url: string | null; players: Map<string, { id: string; nickname: string; nationality: string | null }> }>()
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      const effectiveId = r.team_id ?? (r.pubg_team_name ? (aliasToTeamId.get(r.pubg_team_name.toLowerCase()) ?? null) : null)
      if (!effectiveId || teamRosterMap.has(effectiveId)) continue
      const displayName = r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '?'
      const resolvedLogo = aliasLogoLookup[`${effectiveId}:${displayName}`] ?? aliasLogoLookup[`${effectiveId}:`] ?? null
      teamRosterMap.set(effectiveId, { name: displayName, logo_url: resolvedLogo, players: new Map() })
    }
  }
  for (const r of rosterPlayerData ?? []) {
    const row = r as AnyRow
    const team = teamRosterMap.get(row.team_id)
    if (team && row.player_id && row.players && !team.players.has(row.player_id)) {
      team.players.set(row.player_id, {
        id: row.player_id,
        nickname: row.players.nickname,
        nationality: row.players.nationality ?? null,
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
          ptsMap.set(key, { teamId: row.team_id ?? null, teamName: row.display_name ?? row.teams?.name ?? row.pubg_team_name ?? '?', totalPts: 0, placePts: 0 })
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

  // Drop locations
  const { data: dropLocData } = await supabase
    .from('team_drop_locations')
    .select('id, team_id, map_name, x, y, teams(name, logo_url)')
    .eq('tournament_id', id)

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
            teamStats={teamStats}
            dropLocations={dropLocations}
            mapKeys={mapKeys}
          />
        )}
      </main>
    </>
  )
}
