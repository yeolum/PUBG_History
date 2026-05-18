'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import { createClient } from '@/lib/supabase/client'
import { calcPlacementPts } from '@/lib/scoring'
import type { Stage, Match } from '@/lib/types'

export interface TeamStatRow {
  teamId: string | null
  teamName: string
  logoUrl: string | null
  games: number
  wwcd: number
  totalKills: number
  totalDamage: number
  totalPoints: number
  placementsSum: number
  gamesWithPlacement: number
}

export interface DropLocationRow {
  id: string
  teamId: string
  teamName: string
  logoUrl: string | null
  mapName: string
  x: number
  y: number
}

type SortKey = 'teamName' | 'games' | 'wwcd' | 'totalPoints' | 'avgPlacement' | 'totalKills' | 'kpg' | 'totalDamage' | 'adr'
type StageWithMatches = Stage & { matches: Pick<Match, 'id' | 'status' | 'order_num'>[] }
interface SeriesItem { id: string; name: string; order_num: number; tab_order: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function mapImageUrl(mapKey: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/map-images/${encodeURIComponent(mapKey)}.jpg`
}

interface LandingRow { matchId: string; teamId: string; xNorm: number; yNorm: number }

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function computeDropsFromLandings(
  landings: LandingRow[],
  matchMapLookup: Map<string, string>,
  teamInfoById: Map<string, { teamName: string; logoUrl: string | null }>,
): DropLocationRow[] {
  type Pos = { x: number; y: number }
  const grouped: Record<string, Record<string, Record<string, Pos[]>>> = {}
  for (const l of landings) {
    const mapName = matchMapLookup.get(l.matchId) ?? 'unknown'
    if (!grouped[mapName]) grouped[mapName] = {}
    if (!grouped[mapName][l.teamId]) grouped[mapName][l.teamId] = {}
    if (!grouped[mapName][l.teamId][l.matchId]) grouped[mapName][l.teamId][l.matchId] = []
    grouped[mapName][l.teamId][l.matchId].push({ x: l.xNorm, y: l.yNorm })
  }
  const result: DropLocationRow[] = []
  for (const [mapName, byTeam] of Object.entries(grouped)) {
    for (const [teamId, byMatch] of Object.entries(byTeam)) {
      const centroids = Object.values(byMatch).map((pos) => ({
        x: pos.reduce((s, p) => s + p.x, 0) / pos.length,
        y: pos.reduce((s, p) => s + p.y, 0) / pos.length,
      }))
      const info = teamInfoById.get(teamId)
      result.push({
        id: `computed_${teamId}_${mapName}`,
        teamId,
        teamName: info?.teamName ?? teamId,
        logoUrl: info?.logoUrl ?? null,
        mapName,
        x: median(centroids.map((c) => c.x)),
        y: median(centroids.map((c) => c.y)),
      })
    }
  }
  return result
}

export default function TeamStatsTable({
  teamStats,
  dropLocations,
  mapKeys,
  stages = [],
  series = [],
  resultsByMatch = {},
}: {
  teamStats: TeamStatRow[]
  dropLocations: DropLocationRow[]
  mapKeys: string[]
  stages?: StageWithMatches[]
  series?: SeriesItem[]
  resultsByMatch?: Record<string, AnyRow[]>
}) {
  const [subTab, setSubTab] = useState<'stats' | 'drops'>('stats')
  const [sortKey, setSortKey] = useState<SortKey>('totalPoints')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedMap, setSelectedMap] = useState<string>(mapKeys[0] ?? '')
  const [visibleTeams, setVisibleTeams] = useState<Set<string> | null>(null)
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [dropScopeKey, setDropScopeKey] = useState<string>('total')
  const [allLandings, setAllLandings] = useState<LandingRow[]>([])
  const [matchMapLookup, setMatchMapLookup] = useState<Map<string, string>>(new Map())
  const [landingsLoaded, setLandingsLoaded] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function selectTotal() {
    setSelectedSeriesId(null); setSelectedStageId(null); setSelectedMatchId(null)
  }
  function selectSeries(id: string) {
    setSelectedSeriesId(prev => prev === id ? null : id)
    setSelectedStageId(null); setSelectedMatchId(null)
  }
  function selectStage(stageId: string, seriesId: string | null = null) {
    setSelectedSeriesId(seriesId)
    setSelectedStageId(prev => prev === stageId ? null : stageId)
    setSelectedMatchId(null)
  }
  function toggleMatch(id: string) {
    setSelectedMatchId(prev => prev === id ? null : id)
  }

  const activeMatchIds = useMemo(() => {
    if (selectedMatchId) return new Set([selectedMatchId])
    if (selectedStageId) {
      const stage = stages.find(s => s.id === selectedStageId)
      return new Set(stage?.matches.filter(m => m.status === 'imported').map(m => m.id) ?? [])
    }
    if (selectedSeriesId) {
      const ids = stages
        .filter(s => s.series_id === selectedSeriesId)
        .flatMap(s => s.matches.filter(m => m.status === 'imported').map(m => m.id))
      return new Set(ids)
    }
    return null // null = all (Total)
  }, [selectedMatchId, selectedStageId, selectedSeriesId, stages])

  const logoById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of teamStats) {
      if (t.teamId) m.set(t.teamId, t.logoUrl)
    }
    return m
  }, [teamStats])

  const displayTeamStats = useMemo((): TeamStatRow[] => {
    if (!activeMatchIds) return teamStats
    const map = new Map<string, TeamStatRow>()
    for (const [matchId, rows] of Object.entries(resultsByMatch)) {
      if (!activeMatchIds.has(matchId)) continue
      for (const r of rows) {
        const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
        const teamName = r._resolvedName ?? r.teams?.name ?? r.pubg_team_name ?? '?'
        if (!map.has(key)) {
          map.set(key, {
            teamId: r.team_id ?? null,
            teamName,
            logoUrl: (r.team_id ? logoById.get(r.team_id) : null) ?? r.teams?.logo_url ?? null,
            games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
          })
        }
        const e = map.get(key)!
        e.games++
        if (r.placement === 1) e.wwcd++
        e.totalKills += r.total_kills ?? 0
        e.totalDamage += Number(r.total_damage ?? 0)
        e.totalPoints += calcPlacementPts(r.placement ?? 99) + (r.total_kills ?? 0)
        if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
      }
    }
    return [...map.values()].sort((a, b) => b.totalPoints - a.totalPoints)
  }, [activeMatchIds, teamStats, resultsByMatch, logoById])

  const enriched = useMemo(() => displayTeamStats.map((t) => ({
    ...t,
    avgPlacement: t.gamesWithPlacement > 0 ? t.placementsSum / t.gamesWithPlacement : 99,
    kpg: t.games > 0 ? t.totalKills / t.games : 0,
    adr: t.games > 0 ? t.totalDamage / t.games : 0,
  })), [displayTeamStats])

  const sorted = useMemo(() => [...enriched].sort((a, b) => {
    const dir = sortDir === 'desc' ? -1 : 1
    const av = (a as Record<string, number | string>)[sortKey]
    const bv = (b as Record<string, number | string>)[sortKey]
    if (typeof av === 'string') return dir * av.localeCompare(bv as string)
    if (sortKey === 'avgPlacement') return -dir * ((av as number) - (bv as number))
    return dir * ((av as number) - (bv as number))
  }), [enriched, sortKey, sortDir])

  const thCls = (key: SortKey) =>
    `px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-700 transition-colors ${sortKey === key ? 'text-yellow-600' : 'text-gray-400'}`
  const thLeft = (key: SortKey) =>
    `px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-700 transition-colors ${sortKey === key ? 'text-yellow-600' : 'text-gray-400'}`
  const arr = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  const scopeBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-lg border transition-colors ${active ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`
  const matchBtn = (active: boolean) =>
    `min-w-[28px] px-2 py-1 text-xs font-mono rounded border transition-colors ${active ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`

  // Unified scope-tab order: series + standalone stages interleaved by tab_order.
  // Combined scoreboards are intentionally excluded from these per-match data tables.
  const topScopes = useMemo(() => {
    const items: ({ kind: 'series'; series: SeriesItem; key: number } | { kind: 'stage'; stage: StageWithMatches; key: number })[] = []
    for (const sr of series) items.push({ kind: 'series', series: sr, key: sr.tab_order })
    for (const s of stages) {
      if (s.series_id) continue
      items.push({ kind: 'stage', stage: s, key: s.tab_order })
    }
    return items.sort((a, b) => a.key - b.key)
  }, [series, stages])
  const currentStage = selectedStageId ? stages.find(s => s.id === selectedStageId) : null
  const currentStageMatches = currentStage
    ? [...currentStage.matches].filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
    : []

  // Drop points — stage-aware
  const stageMatchIdsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const s of stages) map.set(s.id, s.matches.filter((m) => m.status === 'imported').map((m) => m.id))
    return map
  }, [stages])

  const teamInfoById = useMemo(() => {
    const map = new Map<string, { teamName: string; logoUrl: string | null }>()
    for (const d of dropLocations) map.set(d.teamId, { teamName: d.teamName, logoUrl: d.logoUrl })
    for (const t of teamStats) {
      if (t.teamId && !map.has(t.teamId)) map.set(t.teamId, { teamName: t.teamName, logoUrl: t.logoUrl })
    }
    return map
  }, [dropLocations, teamStats])

  useEffect(() => {
    if (subTab !== 'drops' || landingsLoaded || stages.length === 0) return
    const matchIds = stages.flatMap((s) => s.matches.filter((m) => m.status === 'imported').map((m) => m.id))
    if (matchIds.length === 0) { setLandingsLoaded(true); return }
    const supabase = createClient()
    Promise.all([
      supabase.from('match_player_landings').select('match_id, team_id, x_norm, y_norm').in('match_id', matchIds).not('team_id', 'is', null),
      supabase.from('matches').select('id, map').in('id', matchIds),
    ]).then(([{ data: landings }, { data: matchMaps }]) => {
      const mapLookup = new Map<string, string>()
      for (const m of matchMaps ?? []) { if (m.map) mapLookup.set(m.id, m.map) }
      setMatchMapLookup(mapLookup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAllLandings((landings ?? []).map((l: any) => ({ matchId: l.match_id, teamId: l.team_id, xNorm: l.x_norm, yNorm: l.y_norm })))
      setLandingsLoaded(true)
    })
  }, [subTab, landingsLoaded, stages])

  const dropsForScope = useMemo((): DropLocationRow[] => {
    if (dropScopeKey === 'total' || !landingsLoaded) return dropLocations
    let scopeIds: Set<string>
    if (dropScopeKey.startsWith('stage:')) {
      scopeIds = new Set(stageMatchIdsMap.get(dropScopeKey.slice(6)) ?? [])
    } else if (dropScopeKey.startsWith('series:')) {
      const seriesId = dropScopeKey.slice(7)
      const ids: string[] = []
      for (const s of stages) { if (s.series_id === seriesId) ids.push(...(stageMatchIdsMap.get(s.id) ?? [])) }
      scopeIds = new Set(ids)
    } else {
      return dropLocations
    }
    const filtered = allLandings.filter((l) => scopeIds.has(l.matchId))
    return computeDropsFromLandings(filtered, matchMapLookup, teamInfoById)
  }, [dropScopeKey, landingsLoaded, dropLocations, allLandings, matchMapLookup, stageMatchIdsMap, stages, teamInfoById])

  const mapsWithDrops = [...new Set(dropLocations.map((d) => d.mapName))].filter((m) => mapKeys.includes(m))
  const allDropMaps = [...new Set([...mapKeys, ...mapsWithDrops])]
  const currentMapDrops = dropsForScope.filter((d) => d.mapName === selectedMap)
  const visibleDrops = visibleTeams === null ? currentMapDrops : currentMapDrops.filter((d) => visibleTeams.has(d.teamId))

  function toggleTeamVisibility(teamId: string) {
    setVisibleTeams((prev) => {
      if (prev === null) {
        const all = new Set(currentMapDrops.map((d) => d.teamId))
        all.delete(teamId)
        return all
      }
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next.size === currentMapDrops.length ? null : next
    })
  }

  const tabBtn = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50/50">
        <button onClick={() => setSubTab('stats')} className={tabBtn(subTab === 'stats')}>Team Stats</button>
        <button onClick={() => setSubTab('drops')} className={tabBtn(subTab === 'drops')}>낙하 지점</button>
      </div>

      {subTab === 'stats' ? (
        teamStats.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No team data available</div>
        ) : (
          <>
            {/* Scope navigator */}
            {stages.length > 0 && (
              <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200 space-y-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button onClick={selectTotal} className={scopeBtn(!selectedSeriesId && !selectedStageId && !selectedMatchId)}>Total</button>
                  {topScopes.map(item => item.kind === 'series' ? (
                    <button key={`series:${item.series.id}`} onClick={() => selectSeries(item.series.id)} className={scopeBtn(selectedSeriesId === item.series.id && !selectedStageId)}>
                      {item.series.name}
                    </button>
                  ) : (
                    <button key={`stage:${item.stage.id}`} onClick={() => selectStage(item.stage.id, null)} className={scopeBtn(selectedStageId === item.stage.id)}>
                      {item.stage.name}
                    </button>
                  ))}
                </div>
                {selectedSeriesId && (
                  <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-yellow-300">
                    {stages.filter(s => s.series_id === selectedSeriesId).map(s => (
                      <button key={s.id} onClick={() => selectStage(s.id, selectedSeriesId)} className={scopeBtn(selectedStageId === s.id)}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                {currentStageMatches.length > 0 && (
                  <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-gray-200">
                    {currentStageMatches.map((m, i) => (
                      <button key={m.id} onClick={() => toggleMatch(m.id)} className={matchBtn(selectedMatchId === m.id)}>
                        M{i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                    <th onClick={() => toggleSort('teamName')} className={thLeft('teamName')}>Team{arr('teamName')}</th>
                    <th onClick={() => toggleSort('games')} className={thCls('games')}>Games{arr('games')}</th>
                    <th onClick={() => toggleSort('wwcd')} className={thCls('wwcd')}>WWCD{arr('wwcd')}</th>
                    <th onClick={() => toggleSort('totalPoints')} className={thCls('totalPoints')}>Total Pts{arr('totalPoints')}</th>
                    <th onClick={() => toggleSort('avgPlacement')} className={thCls('avgPlacement')}>Avg Plc{arr('avgPlacement')}</th>
                    <th onClick={() => toggleSort('totalKills')} className={thCls('totalKills')}>Kills{arr('totalKills')}</th>
                    <th onClick={() => toggleSort('kpg')} className={thCls('kpg')}>KPG{arr('kpg')}</th>
                    <th onClick={() => toggleSort('totalDamage')} className={thCls('totalDamage')}>Damage{arr('totalDamage')}</th>
                    <th onClick={() => toggleSort('adr')} className={thCls('adr')}>ADR{arr('adr')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t, i) => (
                    <tr key={t.teamId ?? t.teamName} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-2 text-center text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {t.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.logoUrl} alt="" className="w-4 h-4 rounded object-contain border border-gray-100 shrink-0" />
                          ) : (
                            <span className="w-4 h-4 rounded bg-gray-100 shrink-0" />
                          )}
                          <span className="font-medium text-gray-800">
                            {t.teamId ? (
                              <Link href={`/teams/${t.teamId}`} className="hover:text-yellow-600">{t.teamName}</Link>
                            ) : t.teamName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{t.games}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{t.wwcd}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">{t.totalPoints}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{t.avgPlacement < 99 ? t.avgPlacement.toFixed(1) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-700">{t.totalKills}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{t.kpg.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{Math.round(t.totalDamage).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{Math.round(t.adr).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        /* Drop Points tab */
        <div className="p-4">
          {allDropMaps.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-10">
              낙하 지점 데이터가 없습니다.<br />
              <span className="text-xs text-gray-300">어드민에서 낙하 지점을 입력해주세요.</span>
            </div>
          ) : (
            <>
              {/* Map selector */}
              <div className="flex gap-1.5 flex-wrap mb-3">
                {allDropMaps.map((mapKey) => (
                  <button
                    key={mapKey}
                    onClick={() => { setSelectedMap(mapKey); setVisibleTeams(null) }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${selectedMap === mapKey ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
                  >
                    {getMapDisplayName(mapKey)}
                  </button>
                ))}
              </div>

              {/* Stage scope filter */}
              {topScopes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <button onClick={() => { setDropScopeKey('total'); setVisibleTeams(null) }} className={scopeBtn(dropScopeKey === 'total')}>
                    Total
                  </button>
                  {topScopes.map((item) => {
                    const key = item.kind === 'series' ? `series:${item.series.id}` : `stage:${item.stage.id}`
                    const label = item.kind === 'series' ? item.series.name : item.stage.name
                    return (
                      <button key={key} onClick={() => { setDropScopeKey(key); setVisibleTeams(null) }} className={scopeBtn(dropScopeKey === key)}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Map + team list */}
              <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 176px' }}>
                <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100" style={{ aspectRatio: '1' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mapImageUrl(selectedMap)}
                    alt={getMapDisplayName(selectedMap)}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="absolute inset-0 grid-pattern opacity-30" />
                  {currentMapDrops.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-400 text-xs bg-white/80 px-3 py-2 rounded-lg">이 맵의 낙하 지점 데이터가 없습니다</p>
                    </div>
                  )}
                  {!landingsLoaded && dropScopeKey !== 'total' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                      <span className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {visibleDrops.map((drop) => (
                    <div
                      key={drop.teamId}
                      className="absolute -translate-x-1/2 -translate-y-1/2 group"
                      style={{ left: `${drop.x * 100}%`, top: `${drop.y * 100}%` }}
                    >
                      {drop.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={drop.logoUrl} alt={drop.teamName} className="w-8 h-8 rounded border-2 border-white shadow-md object-contain" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
                          {drop.teamName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {drop.teamName}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Team list — height matches map via CSS grid */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Teams</p>
                    <button onClick={() => setVisibleTeams(null)} className="text-[11px] text-gray-400 hover:text-gray-600">All</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                    {currentMapDrops.length === 0 ? (
                      <p className="text-xs text-gray-400">낙하 지점 없음</p>
                    ) : (
                      currentMapDrops.map((drop) => {
                        const isVisible = visibleTeams === null || visibleTeams.has(drop.teamId)
                        return (
                          <button
                            key={drop.teamId}
                            onClick={() => toggleTeamVisibility(drop.teamId)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors ${isVisible ? 'bg-gray-100 text-gray-800' : 'bg-white text-gray-400 border border-gray-200'}`}
                          >
                            {drop.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={drop.logoUrl} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                            ) : (
                              <span className="w-5 h-5 rounded bg-gray-300 shrink-0" />
                            )}
                            <span className="truncate font-medium">{drop.teamName}</span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
