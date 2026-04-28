import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Player, TeamAlias } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import TeamHistoryClient from './TeamHistoryClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.from('teams').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Team' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createPublicClient()

  const [{ data: team }, { data: playersData }, { data: aliasesData }] = await Promise.all([
    supabase.from('teams').select('*').eq('id', id).single(),
    supabase.from('players').select('*').eq('team_id', id).eq('is_active', true).order('nickname'),
    supabase.from('team_aliases').select('*').eq('team_id', id),
  ])

  if (!team) notFound()
  const players = (playersData ?? []) as Player[]
  const aliases = (aliasesData ?? []) as TeamAlias[]

  const { data: rawResults } = await supabase
    .from('match_team_results')
    .select(`
      id, placement, total_kills,
      matches(id, order_num, map,
        stages(id, name, type, order_num,
          tournaments(id, name, short_name, start_date, end_date, type)))
    `)
    .eq('team_id', id)
    .order('created_at', { ascending: false })

  const results = (rawResults ?? []) as AnyObj[]

  // --- Build tournament map ---
  type TourEntry = {
    id: string; name: string; short_name: string | null; year: number | null; tourType: string | null
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageId: string | null; finalStageName: string | null
    finalStageRank: number | null; finalStagePrize: string | null
  }
  const tourMap = new Map<string, TourEntry>()
  const stageMatchInfo = new Map<string, Array<{ matchId: string; order_num: number }>>()

  for (const r of results) {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    if (!m || !stage || !tour) continue

    if (!tourMap.has(tour.id)) {
      const year = tour.start_date ? new Date(tour.start_date).getFullYear() :
                   tour.end_date ? new Date(tour.end_date).getFullYear() : null
      tourMap.set(tour.id, {
        id: tour.id, name: tour.name, short_name: tour.short_name,
        year, tourType: tour.type ?? null,
        stages: new Map(), finalStageId: null, finalStageName: null,
        finalStageRank: null, finalStagePrize: null,
      })
    }
    const te = tourMap.get(tour.id)!
    if (!te.stages.has(stage.id)) {
      te.stages.set(stage.id, { id: stage.id, name: stage.name, type: stage.type, order_num: stage.order_num })
    }
    if (!stageMatchInfo.has(stage.id)) stageMatchInfo.set(stage.id, [])
    const sl = stageMatchInfo.get(stage.id)!
    if (!sl.find((x) => x.matchId === m.id)) sl.push({ matchId: m.id, order_num: m.order_num ?? 0 })
  }

  // --- Assign sequential match numbers within each stage ---
  const matchNumMap = new Map<string, number>()
  for (const [, matches] of stageMatchInfo) {
    matches.sort((a, b) => a.order_num - b.order_num)
    matches.forEach((m, i) => matchNumMap.set(m.matchId, i + 1))
  }

  // --- Find the final stage for each tournament ---
  for (const [, te] of tourMap) {
    const stages = [...te.stages.values()]
    const final = stages.find((s) => s.type === 'grand_final') ?? null
    if (final) { te.finalStageId = final.id; te.finalStageName = final.name }
  }

  // --- Compute final stage cumulative standings to find this team's rank ---
  const finalStageIds = [...tourMap.values()].map((te) => te.finalStageId).filter(Boolean) as string[]
  if (finalStageIds.length > 0) {
    const { data: fsMatchesData } = await supabase
      .from('matches')
      .select('id, stage_id')
      .in('stage_id', finalStageIds)
      .eq('status', 'imported')
    const fsMatchIds = (fsMatchesData ?? []).map((m) => m.id)
    if (fsMatchIds.length > 0) {
      const { data: fsAllResults } = await supabase
        .from('match_team_results')
        .select('team_id, pubg_team_name, placement, total_kills, match_id')
        .in('match_id', fsMatchIds)

      for (const stageId of finalStageIds) {
        const stageMatchIds = (fsMatchesData ?? []).filter((m) => m.stage_id === stageId).map((m) => m.id)
        const stageResults = (fsAllResults ?? []).filter((r) => stageMatchIds.includes(r.match_id))
        const ptsMap = new Map<string, { pts: number; placePts: number }>()
        for (const r of stageResults) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          if (!ptsMap.has(key)) ptsMap.set(key, { pts: 0, placePts: 0 })
          const e = ptsMap.get(key)!
          const pp = calcPlacementPts(r.placement ?? 99)
          e.pts += pp + (r.total_kills ?? 0)
          e.placePts += pp
        }
        const sorted = [...ptsMap.entries()].sort((a, b) =>
          b[1].pts !== a[1].pts ? b[1].pts - a[1].pts : b[1].placePts - a[1].placePts
        )
        const rank = sorted.findIndex(([key]) => key === id) + 1
        for (const [, te] of tourMap) {
          if (te.finalStageId === stageId) {
            te.finalStageRank = rank > 0 ? rank : null
          }
        }
      }
    }
  }

  // --- Fetch prize from prize_config ---
  const tourIds = [...tourMap.keys()]
  if (tourIds.length > 0) {
    const { data: prizeData } = await supabase
      .from('tournament_prize_config')
      .select('tournament_id, rank, prize')
      .in('tournament_id', tourIds)
    for (const p of prizeData ?? []) {
      const te = tourMap.get(p.tournament_id)
      if (te && te.finalStageRank != null && p.rank === te.finalStageRank) {
        te.finalStagePrize = p.prize ?? null
      }
    }
  }

  const tourList = [...tourMap.values()]

  // PNC: fetch player rosters per tournament
  const isPnc = ((team as AnyObj).league ?? '').toLowerCase() === 'pnc'
  let tourRosters: Record<string, { id: string; nickname: string }[]> = {}
  if (isPnc) {
    const { data: psRaw } = await supabase
      .from('match_player_stats')
      .select('player_id, players(id, nickname), matches(id, stages(id, tournaments(id)))')
      .eq('team_id', id)
      .not('player_id', 'is', null)
    const rMap = new Map<string, Map<string, string>>()
    for (const row of (psRaw ?? []) as AnyObj[]) {
      const m = row.matches as AnyObj | null
      const stage = m?.stages as AnyObj | null
      const tour = stage?.tournaments as AnyObj | null
      if (!tour?.id || !row.player_id) continue
      if (!rMap.has(tour.id)) rMap.set(tour.id, new Map())
      const pm = rMap.get(tour.id)!
      if (!pm.has(row.player_id)) pm.set(row.player_id, (row.players as AnyObj)?.nickname ?? row.player_id)
    }
    for (const [tourId, pm] of rMap) {
      tourRosters[tourId] = [...pm.entries()]
        .map(([pid, nickname]) => ({ id: pid, nickname }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname))
    }
  }

  // Serialize match results for client
  const matchResults = results.map((r) => {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    return {
      id: r.id as string,
      placement: r.placement as number | null,
      total_kills: r.total_kills as number,
      matchId: m?.id as string | null,
      matchNum: m ? (matchNumMap.get(m.id) ?? 0) : 0,
      mapName: m?.map as string | null,
      stageName: stage?.name as string | null,
      tourId: tour?.id as string | null,
      tourName: (tour?.short_name ?? tour?.name) as string | null,
      year: tour?.start_date ? new Date(tour.start_date as string).getFullYear() :
            tour?.end_date ? new Date(tour.end_date as string).getFullYear() : null,
      tourType: tour?.type as string | null,
    }
  })

  const tourListSerialized = tourList.map((te) => ({
    id: te.id,
    name: te.name,
    short_name: te.short_name,
    year: te.year,
    tourType: te.tourType,
    finalStageName: te.finalStageName,
    finalStageRank: te.finalStageRank,
    finalStagePrize: te.finalStagePrize,
  }))

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="mb-6">
          <Link href="/teams" className="text-sm text-gray-400 hover:text-gray-600">← Teams</Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <aside>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="w-20 h-20 bg-gray-100 rounded-xl mb-4 flex items-center justify-center overflow-hidden">
                {team.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-3xl font-bold text-gray-300">{team.name[0]}</span>
                )}
              </div>
              <h1 className="text-xl font-bold text-gray-900">{team.name}</h1>
              {team.short_name && (
                <p className="text-sm font-mono text-gray-500 mt-0.5">{team.short_name}</p>
              )}
              {team.nationality && (
                <p className="text-sm text-gray-500 mt-2">{team.nationality}</p>
              )}
              {(team as AnyObj).league && (
                <p className="text-sm text-blue-500 mt-1">{(team as AnyObj).league}</p>
              )}
              {team.description && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{team.description}</p>
              )}
              {aliases.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 mb-2">Former Names / Aliases</p>
                  <div className="flex flex-wrap gap-1">
                    {aliases.map((a) => (
                      <span key={a.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {a.alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {players.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Current Roster</h2>
                <ul className="space-y-2">
                  {players.map((p) => (
                    <li key={p.id}>
                      <Link href={`/players/${p.id}`} className="flex items-center gap-2 hover:text-yellow-600">
                        <span className="text-sm font-medium text-gray-800">{p.nickname}</span>
                        {p.real_name && (
                          <span className="text-xs text-gray-400">{p.real_name}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          <TeamHistoryClient
            tourList={tourListSerialized}
            matchResults={matchResults}
            isPnc={isPnc}
            tourRosters={tourRosters}
          />
        </div>
      </main>
    </>
  )
}
