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
    supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points').eq('tournament_id', id).order('rank'),
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

  // Compute grand_final rank board
  type RankEntry = { key: string; teamId: string | null; teamName: string; totalPts: number; placePts: number; rank: number }
  const rankBoard: RankEntry[] = []
  const grandFinalStage = stagesList.find((s) => s.type === 'grand_final')

  if (grandFinalStage) {
    const ptsMap = new Map<string, Omit<RankEntry, 'rank'>>()
    for (const m of grandFinalStage.matches) {
      if (m.status !== 'imported') continue
      for (const r of resultsByMatch[m.id] ?? []) {
        const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
        if (!ptsMap.has(key)) {
          ptsMap.set(key, {
            key,
            teamId: r.team_id ?? null,
            teamName: r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '?',
            totalPts: 0,
            placePts: 0,
          })
        }
        const e = ptsMap.get(key)!
        const pp = calcPlacementPts(r.placement ?? 99)
        e.totalPts += pp + (r.total_kills ?? 0)
        e.placePts += pp
      }
    }
    const sorted = [...ptsMap.values()].sort((a, b) =>
      b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts
    )
    rankBoard.push(...sorted.map((e, i) => ({ ...e, rank: i + 1 })))
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

        {/* Final Standings / Rank Board */}
        {rankBoard.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-semibold text-gray-800">Final Standings</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-5 py-2 w-10">#</th>
                    <th className="text-left px-5 py-2">Team</th>
                    <th className="text-right px-5 py-2">Pts</th>
                    {t.has_prize && <th className="text-right px-5 py-2">Prize</th>}
                    {t.has_pgs_points && <th className="text-right px-5 py-2">PGS</th>}
                    {t.has_pgc_points && <th className="text-right px-5 py-2">PGC</th>}
                  </tr>
                </thead>
                <tbody>
                  {rankBoard.map((row) => {
                    const pc = prizeByRank.get(row.rank)
                    return (
                      <tr key={row.key} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-2.5 text-gray-400 font-mono text-xs">{row.rank}</td>
                        <td className="px-5 py-2.5 font-medium text-gray-800">
                          {row.teamId ? (
                            <Link href={`/teams/${row.teamId}`} className="hover:text-yellow-600">
                              {row.teamName}
                            </Link>
                          ) : (
                            <span>{row.teamName}</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right font-bold text-gray-900">{row.totalPts}</td>
                        {t.has_prize && <td className="px-5 py-2.5 text-right text-gray-700">{pc?.prize ?? '-'}</td>}
                        {t.has_pgs_points && <td className="px-5 py-2.5 text-right text-gray-700">{pc?.pgs_points ?? '-'}</td>}
                        {t.has_pgc_points && <td className="px-5 py-2.5 text-right text-gray-700">{pc?.pgc_points ?? '-'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stage Tabs + Scoreboards */}
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
      </main>
    </>
  )
}
