import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PlayerAlias } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import { getMapDisplayName } from '@/lib/pubg-api'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('players').select('nickname').eq('id', id).single()
  return { title: data?.nickname ?? 'Player' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: player }, { data: aliasesData }] = await Promise.all([
    supabase.from('players').select('*, teams(id, name, short_name, logo_url)').eq('id', id).single(),
    supabase.from('player_aliases').select('*').eq('player_id', id),
  ])

  if (!player) notFound()
  const aliases = (aliasesData ?? []) as PlayerAlias[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = (player as any).teams

  // Fetch all match stats for this player, with full tournament/stage hierarchy
  const { data: rawStats } = await supabase
    .from('match_player_stats')
    .select(`
      id, kills, assists, knocks, damage_dealt, placement, team_id,
      matches(id, order_num, map,
        stages(id, name, type, order_num,
          tournaments(id, name, short_name)))
    `)
    .eq('player_id', id)
    .order('created_at', { ascending: false })

  const stats = (rawStats ?? []) as AnyObj[]

  // Career totals
  const totalKills = stats.reduce((s, r) => s + (r.kills ?? 0), 0)
  const totalDamage = stats.reduce((s, r) => s + Number(r.damage_dealt ?? 0), 0)
  const avgDamage = stats.length > 0 ? totalDamage / stats.length : 0

  // --- Build tournament map (keyed by tour.id) ---
  type TourEntry = {
    id: string; name: string; short_name: string | null
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageId: string | null; finalStageName: string | null
    finalStageRank: number | null; finalStagePts: number | null
    playerTeamId: string | null  // the team the player was on in the final stage
  }
  const tourMap = new Map<string, TourEntry>()
  const stageMatchInfo = new Map<string, Array<{ matchId: string; order_num: number }>>()
  const stagePlayerTeam = new Map<string, string | null>() // stageId -> team_id

  for (const r of stats) {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    if (!m || !stage || !tour) continue

    if (!tourMap.has(tour.id)) {
      tourMap.set(tour.id, {
        id: tour.id, name: tour.name, short_name: tour.short_name,
        stages: new Map(), finalStageId: null, finalStageName: null,
        finalStageRank: null, finalStagePts: null, playerTeamId: null,
      })
    }
    const te = tourMap.get(tour.id)!
    if (!te.stages.has(stage.id)) {
      te.stages.set(stage.id, { id: stage.id, name: stage.name, type: stage.type, order_num: stage.order_num })
    }
    if (!stageMatchInfo.has(stage.id)) stageMatchInfo.set(stage.id, [])
    const sl = stageMatchInfo.get(stage.id)!
    if (!sl.find((x) => x.matchId === m.id)) sl.push({ matchId: m.id, order_num: m.order_num ?? 0 })
    // Track the player's team for this stage
    if (r.team_id && !stagePlayerTeam.has(stage.id)) stagePlayerTeam.set(stage.id, r.team_id)
  }

  // --- Assign sequential match numbers ---
  const matchNumMap = new Map<string, number>()
  for (const [, matches] of stageMatchInfo) {
    matches.sort((a, b) => a.order_num - b.order_num)
    matches.forEach((m, i) => matchNumMap.set(m.matchId, i + 1))
  }

  // --- Find final stage per tournament ---
  for (const [, te] of tourMap) {
    const stages = [...te.stages.values()]
    const final = stages.find((s) => s.type === 'grand_final')
      ?? stages.sort((a, b) => b.order_num - a.order_num)[0]
    if (final) {
      te.finalStageId = final.id
      te.finalStageName = final.name
      te.playerTeamId = stagePlayerTeam.get(final.id) ?? null
    }
  }

  // --- Compute final stage rank for the player's team ---
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
        for (const [, te] of tourMap) {
          if (te.finalStageId === stageId && te.playerTeamId) {
            const rank = sorted.findIndex(([key]) => key === te.playerTeamId) + 1
            te.finalStageRank = rank > 0 ? rank : null
            te.finalStagePts = ptsMap.get(te.playerTeamId)?.pts ?? null
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
            {stats.length === 0 ? (
              <p className="text-gray-400 text-sm">No match records</p>
            ) : (
              <div className="space-y-1.5">
                {stats.map((s) => {
                  const m = s.matches as AnyObj | null
                  const stage = m?.stages as AnyObj | null
                  const tour = stage?.tournaments as AnyObj | null
                  const matchNum = m ? (matchNumMap.get(m.id) ?? 0) : 0
                  return (
                    <div key={s.id} className="bg-white rounded-lg border border-gray-200 px-4 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
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
                        <span className="text-sm font-bold text-gray-700 shrink-0 ml-4">#{s.placement}</span>
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
