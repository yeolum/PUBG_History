'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import { createClient } from '@/lib/supabase/client'
import { calcPlacementPtsWithRule, ruleFromStage, DEFAULT_RULE } from '@/lib/scoring'
import type { Stage, Match, PlanePath } from '@/lib/types'
import FlightPathOverlay from './FlightPathOverlay'

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
  clusterCount?: number
  clusterIndex?: number
  clusterSize?: number
  totalMatches?: number
}

type SortKey = 'teamName' | 'games' | 'wwcd' | 'totalPoints' | 'avgPlacement' | 'totalKills' | 'kpg' | 'totalDamage' | 'adr'
type StageWithMatches = Stage & { matches: Pick<Match, 'id' | 'status' | 'order_num' | 'map'>[] }
interface SeriesItem { id: string; name: string; order_num: number; tab_order: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function mapImageUrl(mapKey: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/map-images/${encodeURIComponent(mapKey)}.jpg`
}

function findAllClusters(points: { x: number; y: number }[], radius = 0.07): { x: number; y: number; size: number }[] {
  if (points.length === 0) return []
  const remaining = [...points]
  const clusters: { x: number; y: number; size: number }[] = []
  while (remaining.length > 0) {
    let bestNbrs: typeof remaining = [remaining[0]]
    for (const p of remaining) {
      const nbrs = remaining.filter((q) => { const dx = q.x - p.x; const dy = q.y - p.y; return dx * dx + dy * dy <= radius * radius })
      if (nbrs.length > bestNbrs.length) bestNbrs = nbrs
    }
    const cx = bestNbrs.reduce((s, p) => s + p.x, 0) / bestNbrs.length
    const cy = bestNbrs.reduce((s, p) => s + p.y, 0) / bestNbrs.length
    clusters.push({ x: cx, y: cy, size: bestNbrs.length })
    for (const n of bestNbrs) { const idx = remaining.indexOf(n); if (idx !== -1) remaining.splice(idx, 1) }
  }
  return clusters.sort((a, b) => b.size - a.size)
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
  const [dropStageId, setDropStageId] = useState<string | null>(null)
  const [rawCentroidsCache, setRawCentroidsCache] = useState<Map<string, { teamId: string; mapName: string; x: number; y: number }[]>>(new Map())
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [matchDropCache, setMatchDropCache] = useState<Map<string, DropLocationRow[]>>(new Map())
  const [flightPathCache, setFlightPathCache] = useState<Map<string, PlanePath | null>>(new Map())

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

  // matchId → scoring rule (mirrors TournamentContent server-side logic)
  const matchToRule = useMemo(() => {
    const map = new Map<string, ReturnType<typeof ruleFromStage>>()
    for (const s of stages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = ruleFromStage((s as any).scoring_rules)
      for (const m of s.matches) map.set(m.id, rule)
    }
    return map
  }, [stages])

  const displayTeamStats = useMemo((): TeamStatRow[] => {
    if (!activeMatchIds) return teamStats
    const map = new Map<string, TeamStatRow>()
    for (const [matchId, rows] of Object.entries(resultsByMatch)) {
      if (!activeMatchIds.has(matchId)) continue
      const rule = matchToRule.get(matchId) ?? DEFAULT_RULE
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
        e.totalPoints += calcPlacementPtsWithRule(r.placement ?? 99, rule) + Math.round((r.total_kills ?? 0) * rule.kill_pts)
        if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
      }
    }
    return [...map.values()].sort((a, b) => b.totalPoints - a.totalPoints)
  }, [activeMatchIds, teamStats, resultsByMatch, logoById, matchToRule])

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

  const teamInfoById = useMemo(() => {
    const map = new Map<string, { teamName: string; logoUrl: string | null }>()
    for (const d of dropLocations) map.set(d.teamId, { teamName: d.teamName, logoUrl: d.logoUrl })
    for (const t of teamStats) {
      if (t.teamId && !map.has(t.teamId)) map.set(t.teamId, { teamName: t.teamName, logoUrl: t.logoUrl })
    }
    return map
  }, [dropLocations, teamStats])

  useEffect(() => {
    if (subTab !== 'drops') return
    if (dropScopeKey === 'total' || dropScopeKey.startsWith('match:')) return
    if (rawCentroidsCache.has(dropScopeKey)) return
    let matchIds: string[] = []
    if (dropScopeKey.startsWith('stage:')) {
      const stageId = dropScopeKey.slice(6)
      const stage = stages.find((s) => s.id === stageId)
      matchIds = stage?.matches.filter((m) => m.status === 'imported').map((m) => m.id) ?? []
    } else if (dropScopeKey.startsWith('series:')) {
      const seriesId = dropScopeKey.slice(7)
      matchIds = stages
        .filter((s) => s.series_id === seriesId)
        .flatMap((s) => s.matches.filter((m) => m.status === 'imported').map((m) => m.id))
    }
    if (matchIds.length === 0) { setRawCentroidsCache((prev) => new Map(prev).set(dropScopeKey, [])); return }
    const supabase = createClient()
    supabase
      .from('match_team_drop_locations')
      .select('team_id, map_name, x, y')
      .in('match_id', matchIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []).map((d: any) => ({ teamId: d.team_id as string, mapName: d.map_name as string, x: d.x as number, y: d.y as number }))
        setRawCentroidsCache((prev) => new Map(prev).set(dropScopeKey, rows))
      })
  }, [subTab, dropScopeKey, rawCentroidsCache, stages])

  useEffect(() => {
    if (!dropScopeKey.startsWith('match:')) return
    const matchId = dropScopeKey.slice(6)
    if (matchDropCache.has(matchId)) return
    const supabase = createClient()
    supabase
      .from('match_team_drop_locations')
      .select('team_id, map_name, x, y')
      .eq('match_id', matchId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: DropLocationRow[] = (data ?? []).map((d: any) => {
          const info = teamInfoById.get(d.team_id)
          return {
            id: `${matchId}_${d.team_id}`,
            teamId: d.team_id,
            teamName: info?.teamName ?? d.team_id,
            logoUrl: info?.logoUrl ?? null,
            mapName: d.map_name,
            x: d.x,
            y: d.y,
          }
        })
        setMatchDropCache((prev) => new Map(prev).set(matchId, rows))
      })
  }, [dropScopeKey, matchDropCache, teamInfoById])

  useEffect(() => {
    if (!dropScopeKey.startsWith('match:')) return
    const matchId = dropScopeKey.slice(6)
    if (flightPathCache.has(matchId)) return
    const supabase = createClient()
    supabase
      .from('match_flight_paths')
      .select('points')
      .eq('match_id', matchId)
      .single()
      .then(({ data }) => {
        const fp = (data?.points as PlanePath | null) ?? null
        setFlightPathCache((prev) => new Map(prev).set(matchId, fp?.jumps && fp.jumps.length >= 2 ? fp : null))
      })
  }, [dropScopeKey, flightPathCache])

  const dropsForScope = useMemo((): DropLocationRow[] => {
    if (dropScopeKey === 'total') return dropLocations
    if (dropScopeKey.startsWith('match:')) {
      const matchId = dropScopeKey.slice(6)
      return matchDropCache.get(matchId) ?? []
    }

    const rawCentroids = rawCentroidsCache.get(dropScopeKey)
    if (!rawCentroids) return []

    const grouped = new Map<string, { x: number[]; y: number[] }>()
    for (const c of rawCentroids) {
      const key = `${c.teamId}\0${c.mapName}`
      if (!grouped.has(key)) grouped.set(key, { x: [], y: [] })
      grouped.get(key)!.x.push(c.x)
      grouped.get(key)!.y.push(c.y)
    }

    const result: DropLocationRow[] = []
    for (const [key, coords] of grouped.entries()) {
      const sep = key.indexOf('\0')
      const teamId = key.slice(0, sep)
      const mapName = key.slice(sep + 1)
      const info = teamInfoById.get(teamId)
      const points = coords.x.map((x, i) => ({ x, y: coords.y[i] }))
      const clusters = findAllClusters(points)
      clusters.forEach((cluster, idx) => {
        result.push({
          id: `${dropScopeKey}_${teamId}_${mapName}_${idx}`,
          teamId,
          teamName: info?.teamName ?? teamId,
          logoUrl: info?.logoUrl ?? null,
          mapName,
          x: cluster.x,
          y: cluster.y,
          clusterCount: clusters.length,
          clusterIndex: idx,
          clusterSize: cluster.size,
          totalMatches: points.length,
        })
      })
    }
    return result
  }, [dropScopeKey, dropLocations, rawCentroidsCache, matchDropCache, teamInfoById])

  const mapsWithDrops = useMemo(() => [...new Set(dropLocations.map((d) => d.mapName))].filter((m) => mapKeys.includes(m)), [dropLocations, mapKeys])
  const allDropMaps = useMemo(() => [...new Set([...mapKeys, ...mapsWithDrops])], [mapKeys, mapsWithDrops])

  // Preload all map images so switching maps is instant
  useEffect(() => {
    for (const k of allDropMaps) {
      const img = new window.Image()
      img.src = mapImageUrl(k)
    }
  }, [allDropMaps])
  const currentMapDrops = dropsForScope.filter((d) => d.mapName === selectedMap)

  // Deduplicated team list: spread teams (clusterCount > 1) sorted to top
  const uniqueTeamsForMap = (() => {
    const seen = new Set<string>()
    const result: DropLocationRow[] = []
    for (const d of currentMapDrops) { if (!seen.has(d.teamId)) { seen.add(d.teamId); result.push(d) } }
    return result.sort((a, b) => {
      const aS = (a.clusterCount ?? 1) > 1; const bS = (b.clusterCount ?? 1) > 1
      if (aS !== bS) return aS ? -1 : 1
      return 0
    })
  })()

  const visibleDrops = currentMapDrops.filter((drop) => {
    if ((drop.clusterIndex ?? 0) > 0) return expandedTeams.has(drop.teamId)
    return visibleTeams === null || visibleTeams.has(drop.teamId)
  })

  function toggleTeamVisibility(teamId: string) {
    const isSpread = currentMapDrops.some((d) => d.teamId === teamId && (d.clusterCount ?? 1) > 1)
    if (isSpread) {
      setExpandedTeams((prev) => {
        const next = new Set(prev)
        if (next.has(teamId)) next.delete(teamId); else next.add(teamId)
        return next
      })
    } else {
      setVisibleTeams((prev) => {
        if (prev === null) {
          const all = new Set(currentMapDrops.filter((d) => (d.clusterCount ?? 1) === 1).map((d) => d.teamId))
          all.delete(teamId)
          return all
        }
        const next = new Set(prev)
        if (next.has(teamId)) next.delete(teamId); else next.add(teamId)
        return next
      })
    }
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
                    onClick={() => {
                      setSelectedMap(mapKey)
                      setVisibleTeams(null)
                      setExpandedTeams(new Set())
                      if (dropScopeKey.startsWith('match:')) {
                        setDropScopeKey(dropStageId ? `stage:${dropStageId}` : 'total')
                      }
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${selectedMap === mapKey ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
                  >
                    {getMapDisplayName(mapKey)}
                  </button>
                ))}
              </div>

              {/* Stage scope filter */}
              {topScopes.length > 0 && (
                <div className="space-y-2 mb-4">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setDropScopeKey('total'); setDropStageId(null); setVisibleTeams(null); setExpandedTeams(new Set()) }}
                      className={scopeBtn(dropScopeKey === 'total')}
                    >
                      Total
                    </button>
                    {topScopes.map((item) => {
                      if (item.kind === 'series') {
                        const key = `series:${item.series.id}`
                        const isActive = dropScopeKey === key
                        return (
                          <button key={key} onClick={() => { setDropScopeKey(key); setDropStageId(null); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(isActive)}>
                            {item.series.name}
                          </button>
                        )
                      }
                      const stageKey = `stage:${item.stage.id}`
                      const isActive = stageKey === dropScopeKey || (dropScopeKey.startsWith('match:') && dropStageId === item.stage.id)
                      return (
                        <button key={stageKey} onClick={() => { setDropScopeKey(stageKey); setDropStageId(item.stage.id); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(isActive)}>
                          {item.stage.name}
                        </button>
                      )
                    })}
                  </div>
                  {/* Series sub-stages */}
                  {dropScopeKey.startsWith('series:') && (() => {
                    const seriesId = dropScopeKey.slice(7)
                    const subStages = stages.filter(s => s.series_id === seriesId)
                    if (subStages.length === 0) return null
                    return (
                      <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-yellow-300">
                        {subStages.map(s => {
                          const isActive = `stage:${s.id}` === dropScopeKey || (dropScopeKey.startsWith('match:') && dropStageId === s.id)
                          return (
                            <button key={s.id} onClick={() => { setDropScopeKey(`stage:${s.id}`); setDropStageId(s.id); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(isActive)}>
                              {s.name}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {/* Match buttons for selected stage — only matches using selectedMap */}
                  {dropStageId && (() => {
                    const stage = stages.find(s => s.id === dropStageId)
                    const allImported = stage?.matches.filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num) ?? []
                    const filtered = allImported.filter(m => !m.map || m.map === selectedMap)
                    if (filtered.length === 0) return null
                    return (
                      <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-gray-200">
                        {allImported.map((m, i) => {
                          if (m.map && m.map !== selectedMap) return null
                          return (
                            <button
                              key={m.id}
                              onClick={() => { setDropScopeKey(`match:${m.id}`); setVisibleTeams(null); setExpandedTeams(new Set()) }}
                              className={matchBtn(dropScopeKey === `match:${m.id}`)}
                            >
                              M{i + 1}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
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
                  {((dropScopeKey !== 'total' && !dropScopeKey.startsWith('match:') && !rawCentroidsCache.has(dropScopeKey)) || (dropScopeKey.startsWith('match:') && !matchDropCache.has(dropScopeKey.slice(6)))) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                      <span className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {/* Flight path overlay — match scope only */}
                  {dropScopeKey.startsWith('match:') && (() => {
                    const fp = flightPathCache.get(dropScopeKey.slice(6))
                    return fp ? <FlightPathOverlay path={fp} /> : null
                  })()}
                  {visibleDrops.map((drop) => {
                    const isSpread = (drop.clusterCount ?? 1) > 1
                    const isPrimary = (drop.clusterIndex ?? 0) === 0
                    return (
                      <div
                        key={drop.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 group"
                        style={{ left: `${drop.x * 100}%`, top: `${drop.y * 100}%` }}
                      >
                        {drop.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={drop.logoUrl}
                            alt={drop.teamName}
                            className={`rounded border-2 shadow-md object-contain ${isSpread ? isPrimary ? 'w-8 h-8 border-orange-400' : 'w-6 h-6 border-orange-300 opacity-70' : 'w-8 h-8 border-white'}`}
                          />
                        ) : (
                          <div className={`rounded border-2 shadow-md flex items-center justify-center text-white font-bold ${isSpread ? isPrimary ? 'w-8 h-8 border-orange-400 bg-orange-600 text-[10px]' : 'w-6 h-6 border-orange-300 bg-orange-400 opacity-70 text-[9px]' : 'w-8 h-8 border-white bg-gray-600 text-[10px]'}`}>
                            {drop.teamName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          {drop.teamName}{isSpread ? ` (${drop.clusterSize}/${drop.totalMatches}경기)` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Team list — height matches map via CSS grid */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Teams</p>
                    <button onClick={() => { setVisibleTeams(null); setExpandedTeams(new Set()) }} className="text-[11px] text-gray-400 hover:text-gray-600">All</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                    {uniqueTeamsForMap.length === 0 ? (
                      <p className="text-xs text-gray-400">낙하 지점 없음</p>
                    ) : (
                      uniqueTeamsForMap.map((drop) => {
                        const isSpread = (drop.clusterCount ?? 1) > 1
                        const isActive = isSpread ? expandedTeams.has(drop.teamId) : (visibleTeams === null || visibleTeams.has(drop.teamId))
                        return (
                          <button
                            key={drop.teamId}
                            onClick={() => toggleTeamVisibility(drop.teamId)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors ${
                              isSpread
                                ? isActive
                                  ? 'bg-orange-100 text-orange-800 border border-orange-300'
                                  : 'bg-orange-50 text-orange-500 border border-orange-200'
                                : isActive
                                  ? 'bg-gray-100 text-gray-800'
                                  : 'bg-white text-gray-400 border border-gray-200'
                            }`}
                          >
                            {drop.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={drop.logoUrl} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                            ) : (
                              <span className={`w-5 h-5 rounded shrink-0 ${isSpread ? 'bg-orange-300' : 'bg-gray-300'}`} />
                            )}
                            <span className="truncate font-medium">{drop.teamName}</span>
                            {isSpread && <span className="ml-auto text-[10px] shrink-0 opacity-70">{drop.clusterCount}곳</span>}
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
