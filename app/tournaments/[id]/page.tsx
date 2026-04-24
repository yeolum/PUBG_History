import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Series, Stage, Match, StageTeamStanding, MatchTeamResult, MatchPlayerStat } from '@/lib/types'
import { getMapDisplayName } from '@/lib/pubg-api'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('tournaments').select('name').eq('id', id).single()
  return { title: data?.name ?? '대회' }
}

const STATUS_LABEL: Record<string, string> = { upcoming: '예정', ongoing: '진행중', completed: '종료' }
const STAGE_TYPE_LABEL: Record<string, string> = { group: '그룹 스테이지', playoff: '플레이오프', grand_final: '그랜드 파이널' }

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: tournament }, { data: seriesData }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase
      .from('series')
      .select('*, stages(*, matches(*))')
      .eq('tournament_id', id)
      .order('order_num'),
  ])

  if (!tournament) notFound()
  const t = tournament as Tournament
  const seriesList = (seriesData ?? []) as (Series & {
    stages: (Stage & { matches: Match[] })[]
  })[]

  // 모든 스테이지 standings 조회
  const allStageIds = seriesList.flatMap((s) => s.stages.map((st) => st.id))
  const { data: standingsData } = allStageIds.length > 0
    ? await supabase.from('stage_team_standings').select('*').in('stage_id', allStageIds)
    : { data: [] }
  const standings = (standingsData ?? []) as StageTeamStanding[]

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        {/* 헤더 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← 대회 목록</Link>
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

        {/* 시리즈 → 스테이지 → 매치 */}
        {seriesList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            시리즈 정보가 없습니다
          </div>
        ) : (
          <div className="space-y-8">
            {seriesList.map((series) => (
              <section key={series.id}>
                <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b border-gray-200 pb-2">
                  {series.name}
                </h2>
                {series.stages.length === 0 ? (
                  <p className="text-sm text-gray-400 pl-2">스테이지 없음</p>
                ) : (
                  <div className="space-y-6">
                    {series.stages
                      .slice()
                      .sort((a, b) => a.order_num - b.order_num)
                      .map((stage) => {
                        const stageStandings = standings
                          .filter((s) => s.stage_id === stage.id)
                          .sort((a, b) => b.total_points - a.total_points)
                        const importedMatches = stage.matches.filter((m) => m.status === 'imported')

                        return (
                          <div key={stage.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-800">{stage.name}</span>
                                <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                                  {STAGE_TYPE_LABEL[stage.type] ?? stage.type}
                                </span>
                              </div>
                              <span className="text-xs text-gray-400">{importedMatches.length}경기</span>
                            </div>

                            {/* 팀 순위 */}
                            {stageStandings.length > 0 && (
                              <div className="p-5">
                                <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">팀 순위</p>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-gray-400 border-b border-gray-100">
                                        <th className="text-left pb-2 w-8">#</th>
                                        <th className="text-left pb-2">팀</th>
                                        <th className="text-right pb-2">경기</th>
                                        <th className="text-right pb-2">킬</th>
                                        <th className="text-right pb-2">데미지</th>
                                        <th className="text-right pb-2 font-bold">포인트</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {stageStandings.map((s, i) => (
                                        <tr key={s.team_id} className="border-b border-gray-50 last:border-0">
                                          <td className="py-1.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                                          <td className="py-1.5 font-medium text-gray-800">
                                            <Link href={`/teams/${s.team_id}`} className="hover:text-yellow-600">
                                              {s.team_name}
                                            </Link>
                                          </td>
                                          <td className="py-1.5 text-right text-gray-500">{s.matches_played}</td>
                                          <td className="py-1.5 text-right text-gray-500">{s.total_kills}</td>
                                          <td className="py-1.5 text-right text-gray-500">{Number(s.total_damage).toFixed(0)}</td>
                                          <td className="py-1.5 text-right font-bold text-gray-900">{s.total_points}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* 매치 목록 */}
                            {stage.matches.length > 0 && (
                              <div className="border-t border-gray-100 p-5">
                                <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">매치</p>
                                <MatchList stageId={stage.id} matches={stage.matches} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

async function MatchList({ stageId, matches }: { stageId: string; matches: Match[] }) {
  const supabase = await createClient()
  const importedIds = matches.filter((m) => m.status === 'imported').map((m) => m.id)

  const { data: teamResults } = importedIds.length > 0
    ? await supabase
        .from('match_team_results')
        .select('*, teams(id, name, short_name)')
        .in('match_id', importedIds)
        .order('placement')
    : { data: [] }

  const resultsByMatch: Record<string, MatchTeamResult[]> = {}
  for (const r of (teamResults ?? []) as MatchTeamResult[]) {
    if (!resultsByMatch[r.match_id]) resultsByMatch[r.match_id] = []
    resultsByMatch[r.match_id].push(r)
  }

  const sorted = [...matches].sort((a, b) => a.order_num - b.order_num)

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((match, i) => {
        const results = resultsByMatch[match.id] ?? []
        const top3 = results.slice(0, 3)
        return (
          <div key={match.id} className="border border-gray-200 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-700">Match {i + 1}</span>
              {match.map && (
                <span className="text-xs text-gray-400">{getMapDisplayName(match.map)}</span>
              )}
            </div>
            {match.status === 'pending' && (
              <p className="text-xs text-gray-400">데이터 없음</p>
            )}
            {match.status === 'error' && (
              <p className="text-xs text-red-500">오류: {match.error_msg}</p>
            )}
            {match.status === 'imported' && top3.length > 0 && (
              <ol className="space-y-1">
                {top3.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400 w-4">{r.placement}</span>
                    <span className="text-gray-700 font-medium truncate">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(r.teams as any)?.name ?? r.pubg_team_name ?? '-'}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">{r.total_kills}킬</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}
