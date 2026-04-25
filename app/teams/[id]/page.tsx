import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Player, TeamAlias } from '@/lib/types'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('teams').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Team' }
}

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

  const { data: matchResults } = await supabase
    .from('match_team_results')
    .select('*, matches(match_date, map, stages(name, tournaments(id, name)))')
    .eq('team_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

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
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
            {(matchResults ?? []).length === 0 ? (
              <p className="text-gray-400 text-sm">No tournament results recorded</p>
            ) : (
              <div className="space-y-2">
                {(matchResults ?? []).map((r) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const m = r.matches as any
                  const stageInfo = m?.stages
                  const tourInfo = stageInfo?.tournaments
                  return (
                    <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between">
                      <div>
                        {tourInfo && (
                          <Link href={`/tournaments/${tourInfo.id}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600">
                            {tourInfo.name}
                          </Link>
                        )}
                        <p className="text-xs text-gray-400">{stageInfo?.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold text-gray-900">#{r.placement}</p>
                        <p className="text-xs text-gray-400">{r.total_kills} kills</p>
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
