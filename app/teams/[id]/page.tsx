import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Player, TeamAlias } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import { getMapDisplayName } from '@/lib/pubg-api'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('teams').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Team' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

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
          tournaments(id, name, short_name)))
    `)
    .eq('team_id', id)
    .order('created_at', { ascending: false })

  const results = (rawResults ?? []) as AnyObj[]

  // --- Build tournament map ---
  type TourEntry = {
    id: string; name: string; short_name: string | null
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageId: string | null; finalStageName: string | null
    finalStageRank: number | null; finalStagePts: number | null
  }
  const tourMap = new Map<string, TourEntry>()
  const stageMatchInfo = new Map<string, Array<{ matchId: string; order_num: number }>>()

  for (const r of results) {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    if (!m || !stage || !tour) continue

    if (!tourMap.has(tour.id)) {
      tourMap.set(tour.id, {
        id: tour.id, name: tour.name, short_name: tour.short_name,
        stages: new Map(), finalStageId: null, finalStageName: null,
        finalStageRank: null, finalStagePts: null,
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
            te.finalStagePts = ptsMap.get(id)?.pts ?? null
          }
        }
      }
    }
  }

  const tourList = [...tourMap.values()]

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

          <div>
            {/* Tournament History */}
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
            {tourList.length === 0 ? (
              <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
            ) : (
              <div className="space-y-2 mb-8">
                {tourList.map((te) => (
                  <div key={te.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <Link href={`/tournaments/${te.id}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600">
                        {te.short_name ?? te.name}
                      </Link>
                      {te.finalStageName && (
                        <p className="text-xs text-gray-400 mt-0.5">{te.finalStageName}</p>
                      )}
                    </div>
                    {te.finalStageRank != null && (
                      <div className="text-right">
                        <p className="text-base font-bold text-gray-900">#{te.finalStageRank}</p>
                        {te.finalStagePts != null && (
                          <p className="text-xs text-gray-400">{te.finalStagePts} pts</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Match History */}
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Match History</h2>
            {results.length === 0 ? (
              <p className="text-gray-400 text-sm">No match records</p>
            ) : (
              <div className="space-y-1.5">
                {results.map((r) => {
                  const m = r.matches as AnyObj | null
                  const stage = m?.stages as AnyObj | null
                  const tour = stage?.tournaments as AnyObj | null
                  const matchNum = m ? (matchNumMap.get(m.id) ?? 0) : 0
                  return (
                    <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-2.5 flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm min-w-0">
                        {tour && (
                          <Link href={`/tournaments/${tour.id}`} className="font-medium text-gray-800 hover:text-yellow-600 shrink-0">
                            {tour.short_name ?? tour.name}
                          </Link>
                        )}
                        {stage && <span className="text-gray-300">·</span>}
                        {stage && <span className="text-xs text-gray-500 shrink-0">{stage.name}</span>}
                        {matchNum > 0 && <span className="text-gray-300">·</span>}
                        {matchNum > 0 && <span className="font-mono text-xs text-gray-500 shrink-0">M{matchNum}</span>}
                        {m?.map && <span className="text-gray-300">·</span>}
                        {m?.map && <span className="text-xs text-gray-400 shrink-0">{getMapDisplayName(m.map)}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <span className="text-sm font-bold text-gray-900">#{r.placement}</span>
                        <span className="text-xs text-gray-500">{r.total_kills}K</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
