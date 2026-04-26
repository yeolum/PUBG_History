import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Stage, Match, TournamentPrizeConfig } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import TournamentStagesView from './TournamentStagesView'
import TournamentRoster from './TournamentRoster'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('tournaments').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Tournament' }
}

const STATUS_LABEL: Record<string, string> = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' }

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: tournament }, { data: stagesData }, { data: prizeConfigData }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase.from('stages').select('*, matches(*)').eq('tournament_id', id).order('order_num'),
    supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, stage_rank').eq('tournament_id', id).order('rank'),
  ])

  if (!tournament) notFound()
  const t = tournament as Tournament
  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]
  const prizeConfig = (prizeConfigData ?? []) as TournamentPrizeConfig[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsByMatch: Record<string, any[]> = {}
  const damageByMatch: Record<string, { placement: number; damage_dealt: number }[]> = {}

  // Query per-stage in parallel to avoid Supabase's 1000-row default limit
  await Promise.all(
    stagesList.map(async (stage) => {
      const stageMatchIds = stage.matches
        .filter((m) => m.status === 'imported')
        .map((m) => m.id)
      if (stageMatchIds.length === 0) return

      const [{ data: trData }, { data: pdData }] = await Promise.all([
        supabase
          .from('match_team_results')
          .select('*, teams(id, name, short_name, logo_url)')
          .in('match_id', stageMatchIds)
          .order('placement'),
        supabase
          .from('match_player_stats')
          .select('match_id, placement, damage_dealt')
          .in('match_id', stageMatchIds),
      ])

      for (const r of trData ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = r as any
        if (!resultsByMatch[row.match_id]) resultsByMatch[row.match_id] = []
        resultsByMatch[row.match_id].push(row)
      }

      for (const d of pdData ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = d as any
        if (!damageByMatch[row.match_id]) damageByMatch[row.match_id] = []
        damageByMatch[row.match_id].push({ placement: row.placement, damage_dealt: Number(row.damage_dealt) })
      }
    })
  )

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
  const teamIdSet = new Set<string>()
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) { if (r.team_id) teamIdSet.add(r.team_id) }
  }
  if (teamIdSet.size > 0) {
    const { data: aliasData } = await supabase
      .from('team_aliases')
      .select('team_id, alias, logo_url')
      .in('team_id', [...teamIdSet])
      .not('logo_url', 'is', null)
    for (const a of aliasData ?? []) {
      const row = a as AnyRow
      if (row.logo_url) aliasLogoLookup[`${row.team_id}:${row.alias}`] = row.logo_url
    }
  }

  // Roster query — players with nationality per team
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

  // Build roster: teams from resultsByMatch, players from rosterPlayerData
  const teamRosterMap = new Map<string, { name: string; logo_url: string | null; players: Map<string, { id: string; nickname: string; nationality: string | null }> }>()
  for (const rows of Object.values(resultsByMatch)) {
    for (const r of rows as AnyRow[]) {
      if (r.team_id && !teamRosterMap.has(r.team_id)) {
        teamRosterMap.set(r.team_id, {
          name: r.teams?.name ?? r.display_name ?? r.pubg_team_name ?? '?',
          logo_url: r.teams?.logo_url ?? null,
          players: new Map(),
        })
      }
    }
  }
  for (const r of rosterPlayerData ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any
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
      id: teamId,
      name: team.name,
      logo_url: team.logo_url,
      players: [...team.players.values()].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Compute per-stage standings (for rank board)
  type StandingsEntry = { teamId: string | null; teamName: string }
  const stageStandingsMap = new Map<string, StandingsEntry[]>()

  for (const stage of stagesList) {
    const ptsMap = new Map<string, { teamId: string | null; teamName: string; totalPts: number; placePts: number }>()
    for (const m of stage.matches) {
      if (m.status !== 'imported') continue
      for (const r of resultsByMatch[m.id] ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = r as any
        const key = row.team_id ?? `pubg:${row.pubg_team_name ?? ''}`
        if (!ptsMap.has(key)) {
          ptsMap.set(key, {
            teamId: row.team_id ?? null,
            teamName: row.display_name ?? row.teams?.name ?? row.pubg_team_name ?? '?',
            totalPts: 0, placePts: 0,
          })
        }
        const e = ptsMap.get(key)!
        const pp = calcPlacementPts(row.placement ?? 99)
        e.totalPts += pp + (row.total_kills ?? 0)
        e.placePts += pp
      }
    }
    const sorted = [...ptsMap.values()].sort((a, b) =>
      b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts
    )
    stageStandingsMap.set(stage.id, sorted)
  }

  // Build rank board from prize_config stage mapping, or fall back to grand_final
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
      standings.forEach((e, i) => {
        rankBoard.push({ rank: i + 1, teamId: e.teamId, teamName: e.teamName })
      })
    }
  }

  const prizeForStandings = prizeConfig.map((p) => ({
    rank: p.rank,
    prize: p.prize,
    pgs_points: p.pgs_points,
    pgc_points: p.pgc_points,
  }))

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

        {/* Stage view + Final Standings */}
        {stagesList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            No stage information available
          </div>
        ) : (
          <TournamentStagesView
            stages={stagesList}
            resultsByMatch={resultsByMatch}
            damageByMatch={damageByMatch}
            rankBoard={rankBoard}
            prizeConfig={prizeForStandings}
            hasPrize={t.has_prize}
            hasPgsPoints={t.has_pgs_points}
            hasPgcPoints={t.has_pgc_points}
            aliasLogoLookup={aliasLogoLookup}
          />
        )}
      </main>
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>
