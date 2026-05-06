import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PlayerAlias } from '@/lib/types'
import type { Metadata } from 'next'
import PlayerHistoryClient from './PlayerHistoryClient'
import { getTournamentFinalStandings } from '@/lib/tournament-standings'

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
        tournaments(id, name, short_name, start_date, end_date, type, currency, banner_url)))
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
    bannerUrl: string | null
    startDate: string | null; endDate: string | null
    currency: string
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageRank: number | null
    finalStageRankLabel: string | null  // 'DQ' when disqualified
    finalStagePrize: number | null
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
        bannerUrl: (tour.banner_url as string | null) ?? null,
        startDate: (tour.start_date as string | null) ?? null,
        endDate: (tour.end_date as string | null) ?? null,
        currency: (tour.currency as string) ?? 'USD',
        stages: new Map(),
        finalStageRank: null, finalStageRankLabel: null, finalStagePrize: null,
        playerTeamId: null,
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

  // Pin the player's team in each tournament: prefer their tournament_players
  // entry, fall back to whatever team they actually played for in any stage.
  const tourIds = [...tourMap.keys()]
  const { data: tpData } = tourIds.length > 0
    ? await supabase
        .from('tournament_players')
        .select('tournament_id, team_id')
        .eq('player_id', id)
        .in('tournament_id', tourIds)
    : { data: [] }
  for (const row of (tpData ?? []) as { tournament_id: string; team_id: string | null }[]) {
    const te = tourMap.get(row.tournament_id)
    if (te && row.team_id) te.playerTeamId = row.team_id
  }
  for (const [, te] of tourMap) {
    if (te.playerTeamId) continue
    te.playerTeamId = [...te.stages.keys()]
      .map((sid) => stagePlayerTeam.get(sid))
      .find((tid): tid is string => !!tid) ?? null
  }

  // --- Resolve final rank + prize using the same Final Standings the
  // tournament page renders, so the values match exactly ---
  await Promise.all(
    [...tourMap.values()].map(async (te) => {
      if (!te.playerTeamId) return
      try {
        const standings = await getTournamentFinalStandings(te.id)
        const my = standings.get(te.playerTeamId)
        if (!my) return
        te.finalStageRank = my.rank === 'DQ' ? null : my.rank
        te.finalStageRankLabel = my.rank === 'DQ' ? 'DQ' : null
        te.finalStagePrize = my.prize
      } catch {
        // standings unavailable — skip
      }
    }),
  )

  const tourListSerialized = [...tourMap.values()].map((te) => ({
    id: te.id,
    name: te.name,
    short_name: te.short_name,
    year: te.year,
    tourType: te.tourType,
    bannerUrl: te.bannerUrl,
    startDate: te.startDate,
    endDate: te.endDate,
    finalStageRank: te.finalStageRank,
    finalStageRankLabel: te.finalStageRankLabel,
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
