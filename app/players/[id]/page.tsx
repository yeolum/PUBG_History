import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PlayerAlias } from '@/lib/types'
import type { Metadata } from 'next'
import { calcPlacementPts } from '@/lib/scoring'
import PlayerHistoryClient from './PlayerHistoryClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.from('players').select('nickname').eq('id', id).single()
  return { title: data?.nickname ?? 'Player' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createPublicClient()

  const [{ data: player }, { data: aliasesData }] = await Promise.all([
    supabase.from('players').select('*, teams(id, name, short_name, logo_url)').eq('id', id).single(),
    supabase.from('player_aliases').select('*').eq('player_id', id),
  ])

  if (!player) notFound()
  const aliases = (aliasesData ?? []) as PlayerAlias[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = (player as any).teams

  // All known names for this player (nickname + all aliases)
  const allNames = [
    (player as AnyObj).nickname as string,
    ...(aliasesData ?? []).map((a: AnyObj) => a.alias as string),
  ].filter(Boolean)

  const STAT_SELECT = `
    id, kills, assists, knocks, damage_dealt, placement, team_id,
    matches(id, order_num, map, match_date,
      stages(id, name, type, order_num,
        series(id, name, order_num),
        tournaments(id, name, short_name, start_date, end_date, type, currency)))
  `

  // Q1: explicitly linked stats
  const { data: linkedData } = await supabase
    .from('match_player_stats')
    .select(STAT_SELECT)
    .eq('player_id', id)
    .limit(2000)

  // Q2: stats where pubg_player_name matches any known alias/nickname
  const { data: nameData } = allNames.length > 0
    ? await supabase
        .from('match_player_stats')
        .select(STAT_SELECT)
        .in('pubg_player_name', allNames)
        .limit(2000)
    : { data: [] }

  // Merge and deduplicate by id
  const seen = new Set<string>()
  const stats: AnyObj[] = []
  for (const s of [...(linkedData ?? []), ...(nameData ?? [])]) {
    if (!seen.has(s.id)) { seen.add(s.id as string); stats.push(s) }
  }

  // --- Build tournament map (keyed by tour.id) ---
  type TourEntry = {
    id: string; name: string; short_name: string | null; year: number | null; tourType: string | null
    currency: string
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageId: string | null; finalStageName: string | null
    finalStageRank: number | null; finalStagePrize: number | null
    playerTeamId: string | null
  }
  const tourMap = new Map<string, TourEntry>()
  const stageMatchInfo = new Map<string, Array<{ matchId: string; order_num: number }>>()
  const stagePlayerTeam = new Map<string, string | null>()

  for (const r of stats) {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    if (!m || !stage || !tour) continue

    if (!tourMap.has(tour.id)) {
      const year = tour.start_date ? new Date(tour.start_date as string).getFullYear() :
                   tour.end_date ? new Date(tour.end_date as string).getFullYear() : null
      tourMap.set(tour.id, {
        id: tour.id, name: tour.name, short_name: tour.short_name,
        year, tourType: tour.type ?? null,
        currency: (tour.currency as string) ?? 'USD',
        stages: new Map(), finalStageId: null, finalStageName: null,
        finalStageRank: null, finalStagePrize: null, playerTeamId: null,
      })
    }
    const te = tourMap.get(tour.id)!
    if (!te.stages.has(stage.id)) {
      te.stages.set(stage.id, { id: stage.id, name: stage.name, type: stage.type, order_num: stage.order_num })
    }
    if (!stageMatchInfo.has(stage.id)) stageMatchInfo.set(stage.id, [])
    const sl = stageMatchInfo.get(stage.id)!
    if (!sl.find((x) => x.matchId === m.id)) sl.push({ matchId: m.id, order_num: m.order_num ?? 0 })
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
    const final = stages.find((s) => s.type === 'grand_final') ?? null
    if (final) {
      te.finalStageId = final.id
      te.finalStageName = final.name
      // Fall back to any stage's team if final stage has no team_id
      te.playerTeamId = stagePlayerTeam.get(final.id)
        ?? [...te.stages.keys()].map((sid) => stagePlayerTeam.get(sid)).find((tid): tid is string => !!tid)
        ?? null
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
        te.finalStagePrize = p.prize != null ? Number(p.prize) : null
      }
    }
  }

  const tourListSerialized = [...tourMap.values()].map((te) => ({
    id: te.id,
    name: te.name,
    short_name: te.short_name,
    year: te.year,
    tourType: te.tourType,
    finalStageName: te.finalStageName,
    finalStageRank: te.finalStageRank,
    finalStagePrize: te.finalStagePrize,
    currency: te.currency,
  }))

  // Serialize match stats for client, sorted by match_date desc (most recent first)
  const statsSerialized = stats.map((s) => {
    const m = s.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const series = stage?.series as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    return {
      id: s.id as string,
      kills: s.kills as number,
      assists: s.assists as number,
      knocks: s.knocks as number,
      damage_dealt: Number(s.damage_dealt ?? 0),
      placement: s.placement as number | null,
      matchNum: m ? (matchNumMap.get(m.id) ?? 0) : 0,
      matchDate: m?.match_date as string | null,
      mapName: m?.map as string | null,
      stageId: stage?.id as string | null,
      stageName: stage?.name as string | null,
      seriesId: series?.id as string | null,
      seriesName: series?.name as string | null,
      tourId: tour?.id as string | null,
      tourName: (tour?.short_name ?? tour?.name) as string | null,
      year: tour?.start_date ? new Date(tour.start_date as string).getFullYear() :
            tour?.end_date ? new Date(tour.end_date as string).getFullYear() : null,
      tourType: tour?.type as string | null,
    }
  }).sort((a, b) => (b.matchDate ?? '').localeCompare(a.matchDate ?? ''))

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
              <div className="w-20 h-20 bg-gray-100 rounded-lg mb-4 flex items-center justify-center overflow-hidden">
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
                <div className="flex items-center gap-1.5 mt-2">
                  {(player as AnyObj).nationality_code && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`https://flagcdn.com/w20/${((player as AnyObj).nationality_code as string).toLowerCase()}.png`}
                      alt={(player as AnyObj).nationality_code as string}
                      className="w-4 h-3 object-cover shrink-0"
                    />
                  )}
                  <p className="text-sm text-gray-500">{player.nationality}</p>
                </div>
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
          </aside>

          <PlayerHistoryClient
            tourList={tourListSerialized}
            stats={statsSerialized}
          />
        </div>
      </main>
    </>
  )
}
