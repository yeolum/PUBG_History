import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Stage, Match, TournamentPrizeConfig } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import TournamentStagesView from './TournamentStagesView'

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
  const prizeByRank = new Map(prizeConfig.map((p) => [p.rank, p]))

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
          .select('*, teams(id, name, short_name)')
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

  // Compute per-stage standings
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

  // Build rank board from prize_config stage mapping, or fall back to grand_final standings
  type RankEntry = { teamId: string | null; teamName: string; rank: number }
  const rankBoard: RankEntry[] = []

  const hasStageMapping = prizeConfig.some((p) => p.stage_id != null && p.stage_rank != null)

  if (hasStageMapping) {
    for (const pc of prizeConfig) {
      if (!pc.stage_id || !pc.stage_rank) continue
      const standings = stageStandingsMap.get(pc.stage_id) ?? []
      const entry = standings[pc.stage_rank - 1]
      if (entry) {
        rankBoard.push({ rank: pc.rank, teamId: entry.teamId, teamName: entry.teamName })
      }
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

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← Tournaments</Link>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-1">
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
                <p className="text-sm text-gray-400 mt-1">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
              )}
              {t.prize_pool && <p className="text-base font-semibold text-yellow-600 mt-1">{t.prize_pool}</p>}
              {t.description && <p className="text-sm text-gray-600 mt-2">{t.description}</p>}
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* Final Standings — left column */}
          {rankBoard.length > 0 && (
            <div className="lg:w-64 w-full shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-800">Final Standings</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-3 py-2 w-8">#</th>
                    <th className="text-left px-3 py-2">Team</th>
                    {t.has_prize && <th className="text-right px-3 py-2">Prize</th>}
                    {t.has_pgs_points && <th className="text-right px-3 py-2">PGS</th>}
                    {t.has_pgc_points && <th className="text-right px-3 py-2">PGC</th>}
                  </tr>
                </thead>
                <tbody>
                  {rankBoard.map((row) => {
                    const pc = prizeByRank.get(row.rank)
                    const rankColor =
                      row.rank === 1 ? 'text-yellow-500 font-bold' :
                      row.rank === 2 ? 'text-gray-400 font-semibold' :
                      row.rank === 3 ? 'text-amber-600 font-semibold' :
                      'text-gray-300'
                    return (
                      <tr key={row.rank} className={`border-b border-gray-50 last:border-0 ${row.rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                        <td className={`px-3 py-2 font-mono text-xs ${rankColor}`}>{row.rank}</td>
                        <td className="px-3 py-2 font-medium text-gray-800 text-xs leading-snug">
                          {row.teamId ? (
                            <Link href={`/teams/${row.teamId}`} className="hover:text-yellow-600">
                              {row.teamName}
                            </Link>
                          ) : (
                            <span>{row.teamName}</span>
                          )}
                        </td>
                        {t.has_prize && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.prize ?? '-'}</td>}
                        {t.has_pgs_points && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.pgs_points ?? '-'}</td>}
                        {t.has_pgc_points && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.pgc_points ?? '-'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Stage Tabs + Scoreboards — right column */}
          <div className="flex-1 min-w-0">
            {stagesList.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
                No stage information available
              </div>
            ) : (
              <TournamentStagesView
                stages={stagesList}
                resultsByMatch={resultsByMatch}
                damageByMatch={damageByMatch}
              />
            )}
          </div>
        </div>
      </main>
    </>
  )
}
