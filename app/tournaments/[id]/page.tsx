import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament, Stage, Match } from '@/lib/types'
import type { Metadata } from 'next'
import MatchStageView from './MatchStageView'

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

  const [{ data: tournament }, { data: stagesData }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase
      .from('stages')
      .select('*, matches(*)')
      .eq('tournament_id', id)
      .order('order_num'),
  ])

  if (!tournament) notFound()
  const t = tournament as Tournament
  const stagesList = (stagesData ?? []) as (Stage & { matches: Match[] })[]

  const allMatchIds = stagesList.flatMap((s) =>
    s.matches.filter((m) => m.status === 'imported').map((m) => m.id)
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsByMatch: Record<string, any[]> = {}
  const damageByMatch: Record<string, { placement: number; damage_dealt: number }[]> = {}

  if (allMatchIds.length > 0) {
    const [{ data: trData }, { data: pdData }] = await Promise.all([
      supabase
        .from('match_team_results')
        .select('*, teams(id, name, short_name)')
        .in('match_id', allMatchIds)
        .order('placement'),
      supabase
        .from('match_player_stats')
        .select('match_id, placement, damage_dealt')
        .in('match_id', allMatchIds),
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

        {stagesList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            No stage information available
          </div>
        ) : (
          <div className="space-y-6">
            {stagesList.map((stage) => (
              <MatchStageView
                key={stage.id}
                stage={stage}
                matches={stage.matches}
                resultsByMatch={resultsByMatch}
                damageByMatch={damageByMatch}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
