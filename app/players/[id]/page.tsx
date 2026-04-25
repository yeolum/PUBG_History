import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PlayerAlias } from '@/lib/types'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('players').select('nickname').eq('id', id).single()
  return { title: data?.nickname ?? 'Player' }
}

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: player }, { data: aliasesData }] = await Promise.all([
    supabase.from('players').select('*, teams(id, name, short_name, logo_url)').eq('id', id).single(),
    supabase.from('player_aliases').select('*').eq('player_id', id),
  ])

  if (!player) notFound()
  const aliases = (aliasesData ?? []) as PlayerAlias[]

  const { data: statsData } = await supabase
    .from('match_player_stats')
    .select('*, matches(match_date, map, stages(name, tournaments(id, name)))')
    .eq('player_id', id)
    .order('created_at', { ascending: false })
    .limit(30)

  const stats = statsData ?? []
  const totalKills = stats.reduce((s, r) => s + (r.kills ?? 0), 0)
  const totalDamage = stats.reduce((s, r) => s + (r.damage_dealt ?? 0), 0)
  const avgDamage = stats.length > 0 ? totalDamage / stats.length : 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = (player as any).teams

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="mb-6">
          <Link href="/players" className="text-sm text-gray-400 hover:text-gray-600">← Players</Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <aside>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="w-20 h-20 bg-gray-100 rounded-full mb-4 flex items-center justify-center overflow-hidden">
                {player.profile_pic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={player.profile_pic} alt={player.nickname} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-gray-300">{player.nickname[0]}</span>
                )}
              </div>
              <h1 className="text-xl font-bold text-gray-900">{player.nickname}</h1>
              {player.real_name && (
                <p className="text-sm text-gray-500 mt-0.5">{player.real_name}</p>
              )}
              {player.nationality && (
                <p className="text-sm text-gray-500 mt-2">{player.nationality}</p>
              )}
              {player.birth_date && (
                <p className="text-sm text-gray-400 mt-1">{player.birth_date}</p>
              )}
              {team && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 mb-2">Current Team</p>
                  <Link href={`/teams/${team.id}`} className="flex items-center gap-2 hover:text-yellow-600">
                    {team.logo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={team.logo_url} alt={team.name} className="w-6 h-6 object-contain" />
                    )}
                    <span className="text-sm font-medium text-gray-800">{team.name}</span>
                  </Link>
                </div>
              )}
              {aliases.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 mb-2">Former Nicknames / Aliases</p>
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

            {stats.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Career Stats</h2>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Matches" value={stats.length} />
                  <StatBox label="Total Kills" value={totalKills} />
                  <StatBox label="Avg Damage" value={avgDamage.toFixed(0)} />
                  <StatBox label="Avg Kills" value={(totalKills / stats.length).toFixed(1)} />
                </div>
              </div>
            )}
          </aside>

          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Match History</h2>
            {stats.length === 0 ? (
              <p className="text-gray-400 text-sm">No match records</p>
            ) : (
              <div className="space-y-2">
                {stats.map((s) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const m = s.matches as any
                  const stageInfo = m?.stages
                  const tourInfo = stageInfo?.tournaments
                  return (
                    <div key={s.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          {tourInfo && (
                            <Link href={`/tournaments/${tourInfo.id}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600">
                              {tourInfo.name}
                            </Link>
                          )}
                          <p className="text-xs text-gray-400">{stageInfo?.name}</p>
                        </div>
                        <span className="text-sm font-bold text-gray-700">#{s.placement}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs text-center">
                        <div>
                          <p className="text-gray-400">Kills</p>
                          <p className="font-semibold text-gray-800">{s.kills}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Assists</p>
                          <p className="font-semibold text-gray-800">{s.assists}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Knocks</p>
                          <p className="font-semibold text-gray-800">{s.knocks}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Damage</p>
                          <p className="font-semibold text-gray-800">{Number(s.damage_dealt).toFixed(0)}</p>
                        </div>
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

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}
