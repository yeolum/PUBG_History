import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Player, TeamAlias } from '@/lib/types'
import type { Metadata } from 'next'
import TeamHistoryClient from './TeamHistoryClient'
import { getTournamentFinalStandings } from '@/lib/tournament-standings'
import { getMapDisplayName } from '@/lib/pubg-api'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.from('teams').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Team' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginateQuery(q: any): Promise<AnyObj[]> {
  const all: AnyObj[] = []
  let page = 0
  while (true) {
    const { data: batch } = await q.order('id').range(page * 1000, (page + 1) * 1000 - 1)
    if (!batch || batch.length === 0) break
    all.push(...(batch as AnyObj[]))
    if (batch.length < 1000) break
    page++
  }
  return all
}

type ChildTeam = { id: string; name: string; short_name: string | null }
type SubTeamResult = { teamId: string; teamName: string; rank: number | null; rankLabel: string | null; prize: number | null }

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createPublicClient()

  const [{ data: team }, { data: playersData }, { data: aliasesData }, { data: childTeamsData }, { data: dropLocsRaw }] = await Promise.all([
    supabase.from('teams').select('*').eq('id', id).single(),
    supabase.from('players').select('*').eq('team_id', id).eq('is_active', true).order('nickname'),
    supabase.from('team_aliases').select('*').eq('team_id', id),
    supabase.from('teams').select('id, name, short_name').eq('parent_team_id', id),
    supabase.from('team_drop_locations').select('map_name, x, y').eq('team_id', id),
  ])

  if (!team) notFound()

  const dropsByMap = new Map<string, { x: number; y: number }[]>()
  for (const d of (dropLocsRaw ?? []) as { map_name: string; x: number; y: number }[]) {
    if (!dropsByMap.has(d.map_name)) dropsByMap.set(d.map_name, [])
    dropsByMap.get(d.map_name)!.push({ x: d.x, y: d.y })
  }
  const dropZones = [...dropsByMap.entries()].map(([mapName, entries]) => ({
    mapName,
    x: entries.reduce((s, e) => s + e.x, 0) / entries.length,
    y: entries.reduce((s, e) => s + e.y, 0) / entries.length,
  }))
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  const players = (playersData ?? []) as Player[]
  const aliases = (aliasesData ?? []) as TeamAlias[]
  const childTeams = (childTeamsData ?? []) as ChildTeam[]

  // Fetch parent team info + child team aliases in parallel
  const parentTeamId = (team as AnyObj).parent_team_id as string | null
  const childTeamIds = childTeams.map((ct) => ct.id)

  const [parentTeamResult, childAliasesResult] = await Promise.all([
    parentTeamId
      ? supabase.from('teams').select('id, name').eq('id', parentTeamId).single()
      : Promise.resolve({ data: null }),
    childTeamIds.length > 0
      ? supabase.from('team_aliases').select('team_id, alias').in('team_id', childTeamIds)
      : Promise.resolve({ data: [] as { team_id: string; alias: string }[] }),
  ])
  const parentTeam = parentTeamResult.data as { id: string; name: string } | null
  const childAliasRows = (childAliasesResult.data ?? []) as { team_id: string; alias: string }[]

  // Build tag lists for parent team
  const allTags = [
    ...([(team as AnyObj).short_name as string].filter(Boolean)),
    ...(aliasesData ?? []).flatMap((a: AnyObj) => {
      const alias = a.alias as string
      if (!alias) return []
      const dashIdx = alias.indexOf(' - ')
      return dashIdx !== -1 ? [alias.slice(0, dashIdx).trim()] : [alias]
    }),
  ].filter(Boolean)
  const uniqueTags = [...new Set(allTags)] as string[]

  // Build tag lists for each child team
  const childTeamTagsMap = new Map<string, string[]>()
  for (const ct of childTeams) {
    const ctAliases = childAliasRows.filter((a) => a.team_id === ct.id)
    const ctTags = [
      ct.short_name,
      ...ctAliases.flatMap((a) => {
        const dashIdx = a.alias.indexOf(' - ')
        return dashIdx !== -1 ? [a.alias.slice(0, dashIdx).trim()] : [a.alias]
      }),
    ].filter(Boolean) as string[]
    childTeamTagsMap.set(ct.id, [...new Set(ctTags)])
  }

  const RESULT_SELECT = `
    id, placement, total_kills, total_damage,
    matches(id, order_num, map, match_date,
      stages(id, name, type, order_num,
        series(id, name, order_num),
        tournaments(id, name, short_name, start_date, end_date, type, currency, banner_url)))
  `

  // Fetch parent + all child team results in parallel
  const parentFetch = Promise.all([
    paginateQuery(supabase.from('match_team_results').select(RESULT_SELECT).eq('team_id', id)),
    uniqueTags.length > 0
      ? paginateQuery(supabase.from('match_team_results').select(RESULT_SELECT).in('pubg_team_name', uniqueTags).is('team_id', null))
      : Promise.resolve([] as AnyObj[]),
  ])
  const childFetches = childTeams.map((ct) => {
    const ctTags = childTeamTagsMap.get(ct.id) ?? []
    return Promise.all([
      paginateQuery(supabase.from('match_team_results').select(RESULT_SELECT).eq('team_id', ct.id)),
      ctTags.length > 0
        ? paginateQuery(supabase.from('match_team_results').select(RESULT_SELECT).in('pubg_team_name', ctTags).is('team_id', null))
        : Promise.resolve([] as AnyObj[]),
    ])
  })

  const [[linkedData, tagData], ...childResultPairs] = await Promise.all([parentFetch, ...childFetches])

  // Combine: parent results first, then child results (deduplicated globally)
  const seenIds = new Set<string>()
  type TaggedResult = AnyObj & { _subTeamId: string | null; _subTeamName: string | null }
  const allResults: TaggedResult[] = []

  const linkedResults = linkedData as AnyObj[]
  const tagResults = tagData as AnyObj[]
  for (const r of linkedResults) { seenIds.add(r.id); allResults.push({ ...r, _subTeamId: null, _subTeamName: null }) }
  for (const r of tagResults) {
    if (!seenIds.has(r.id)) { seenIds.add(r.id); allResults.push({ ...r, _subTeamId: null, _subTeamName: null }) }
  }
  for (let i = 0; i < childTeams.length; i++) {
    const ct = childTeams[i]
    const ctName = ct.short_name ?? ct.name
    const [ctLinkedArr, ctTagArr] = childResultPairs[i] as [AnyObj[], AnyObj[]]
    const ctSeen = new Set(ctLinkedArr.map((r) => r.id))
    const ctResults = [...ctLinkedArr, ...ctTagArr.filter((r) => !ctSeen.has(r.id))]
    for (const r of ctResults) {
      if (!seenIds.has(r.id)) { seenIds.add(r.id); allResults.push({ ...r, _subTeamId: ct.id, _subTeamName: ctName }) }
    }
  }

  // --- Build tournament map ---
  type TourEntry = {
    id: string; name: string; short_name: string | null; year: number | null; tourType: string | null
    bannerUrl: string | null
    startDate: string | null; endDate: string | null
    currency: string
    stages: Map<string, { id: string; name: string; type: string; order_num: number }>
    finalStageRank: number | null
    finalStageRankLabel: string | null
    finalStagePrize: number | null
    subTeamResults: SubTeamResult[]
  }
  const tourMap = new Map<string, TourEntry>()
  const stageMatchInfo = new Map<string, Array<{ matchId: string; order_num: number }>>()

  for (const r of allResults) {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    if (!m || !stage || !tour) continue

    if (!tourMap.has(tour.id)) {
      const year = tour.start_date ? new Date(tour.start_date).getFullYear() :
                   tour.end_date ? new Date(tour.end_date).getFullYear() : null
      tourMap.set(tour.id, {
        id: tour.id, name: tour.name, short_name: tour.short_name,
        year, tourType: tour.type ?? null,
        bannerUrl: (tour.banner_url as string | null) ?? null,
        startDate: (tour.start_date as string | null) ?? null,
        endDate: (tour.end_date as string | null) ?? null,
        currency: (tour.currency as string) ?? 'USD',
        stages: new Map(),
        finalStageRank: null, finalStageRankLabel: null, finalStagePrize: null,
        subTeamResults: [],
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

  // --- Resolve final rank + prize for parent team and each child team ---
  await Promise.all(
    [...tourMap.values()].map(async (te) => {
      try {
        const standings = await getTournamentFinalStandings(te.id)
        // Parent team's standing
        const my = standings.get(id)
        if (my) {
          te.finalStageRank = my.rank === 'DQ' ? null : (my.rank as number)
          te.finalStageRankLabel = my.rank === 'DQ' ? 'DQ' : null
          te.finalStagePrize = my.prize
        }
        // Child teams' standings (shown per-team in breakdown)
        for (const ct of childTeams) {
          const ctS = standings.get(ct.id)
          if (ctS) {
            te.subTeamResults.push({
              teamId: ct.id,
              teamName: ct.short_name ?? ct.name,
              rank: ctS.rank === 'DQ' ? null : (ctS.rank as number),
              rankLabel: ctS.rank === 'DQ' ? 'DQ' : null,
              prize: ctS.prize,
            })
          }
        }
      } catch {
        // standings unavailable — skip
      }
    }),
  )

  const tourList = [...tourMap.values()]

  // PNC: fetch player rosters per tournament
  const isPnc = ((team as AnyObj).league ?? '').toLowerCase() === 'pnc'
  let tourRosters: Record<string, { id: string; nickname: string }[]> = {}
  if (isPnc) {
    const { data: psRaw } = await supabase
      .from('match_player_stats')
      .select('player_id, players(id, nickname), matches(id, stages(id, tournaments(id)))')
      .eq('team_id', id)
      .not('player_id', 'is', null)
    const rMap = new Map<string, Map<string, string>>()
    for (const row of (psRaw ?? []) as AnyObj[]) {
      const m = row.matches as AnyObj | null
      const stage = m?.stages as AnyObj | null
      const tour = stage?.tournaments as AnyObj | null
      if (!tour?.id || !row.player_id) continue
      if (!rMap.has(tour.id)) rMap.set(tour.id, new Map())
      const pm = rMap.get(tour.id)!
      if (!pm.has(row.player_id)) pm.set(row.player_id, (row.players as AnyObj)?.nickname ?? row.player_id)
    }
    for (const [tourId, pm] of rMap) {
      tourRosters[tourId] = [...pm.entries()]
        .map(([pid, nickname]) => ({ id: pid, nickname }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname))
    }
  }

  // Serialize match results for client, sorted by match_date desc
  const matchResults = allResults.map((r) => {
    const m = r.matches as AnyObj | null
    const stage = m?.stages as AnyObj | null
    const series = stage?.series as AnyObj | null
    const tour = stage?.tournaments as AnyObj | null
    return {
      id: r.id as string,
      placement: r.placement as number | null,
      total_kills: r.total_kills as number,
      total_damage: Number(r.total_damage ?? 0),
      matchId: m?.id as string | null,
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
      subTeamName: r._subTeamName ?? null,
    }
  }).sort((a, b) => (b.matchDate ?? '').localeCompare(a.matchDate ?? ''))

  const tourListSerialized = tourList.map((te) => ({
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
    subTeamResults: te.subTeamResults,
  }))

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="mb-6">
          <Link href="/teams" className="text-sm text-gray-400 hover:text-gray-600">← Teams</Link>
        </div>

        {/* Team info + roster - 한 카드 안에 70% / 30% */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          <div className="flex gap-8">
            {/* 왼쪽 70% - 팀 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                  {team.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-3xl font-bold text-gray-300">{team.name[0]}</span>
                  )}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{team.name}</h1>
                  {team.short_name && <p className="text-sm font-mono text-gray-500 mt-0.5">{team.short_name}</p>}
                  {team.nationality && <p className="text-sm text-gray-500 mt-1">{team.nationality}</p>}
                  {(team as AnyObj).league && <p className="text-sm text-blue-500 mt-0.5">{(team as AnyObj).league}</p>}
                </div>
              </div>
              {team.description && <p className="text-sm text-gray-600 mb-4 leading-relaxed">{team.description}</p>}
              {parentTeam && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-400 mb-1">소속 조직</p>
                  <Link href={`/teams/${parentTeam.id}`} className="text-sm font-medium text-yellow-600 hover:text-yellow-700">{parentTeam.name}</Link>
                </div>
              )}
              {aliases.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-400 mb-2">Former Names / Aliases</p>
                  <div className="flex flex-wrap gap-1">
                    {aliases.map((a) => (
                      <span key={a.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{a.alias}</span>
                    ))}
                  </div>
                </div>
              )}
              {childTeams.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">산하 팀</p>
                  <div className="flex flex-wrap gap-2">
                    {childTeams.map((ct) => (
                      <Link key={ct.id} href={`/teams/${ct.id}`} className="text-sm text-gray-700 hover:text-yellow-600 transition-colors">
                        {ct.name}{ct.short_name && <span className="text-xs text-gray-400 ml-1">({ct.short_name})</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* 오른쪽 30% - 로스터 */}
            {players.length > 0 && (
              <div className="w-[30%] shrink-0 border-l border-gray-100 pl-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Current Roster</h2>
                <ul className="space-y-2">
                  {players.map((p) => (
                    <li key={p.id}>
                      <Link href={`/players/${p.id}`} className="flex items-center gap-2 hover:text-yellow-600">
                        <span className="text-sm font-medium text-gray-800">{p.nickname}</span>
                        {p.real_name && <span className="text-xs text-gray-400">{p.real_name}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <TeamHistoryClient
          tourList={tourListSerialized}
          matchResults={matchResults}
          isPnc={isPnc}
          tourRosters={tourRosters}
        />

        {dropZones.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">낙하 지점</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {dropZones.map(({ mapName, x, y }) => (
                <div key={mapName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="relative" style={{ aspectRatio: '1' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${supabaseUrl}/storage/v1/object/public/map-images/${mapName}.jpg`}
                      alt={getMapDisplayName(mapName)}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    >
                      {(team as AnyObj).logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(team as AnyObj).logo_url}
                          alt={team.name}
                          className="w-8 h-8 rounded-full border-2 border-white shadow-lg object-contain bg-white"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full border-2 border-white shadow-lg bg-gray-600 flex items-center justify-center text-white text-xs font-bold">
                          {team.name[0]}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs font-medium text-gray-700">{getMapDisplayName(mapName)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
