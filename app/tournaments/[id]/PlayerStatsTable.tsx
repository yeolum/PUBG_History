'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Stage, Match } from '@/lib/types'

export interface PlayerStatRow {
  playerId: string | null
  nickname: string
  teamId: string | null
  teamName: string
  logoUrl: string | null
  games: number
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damage: number
  survivalTime: number
}

export interface PlayerMatchStat {
  playerId: string | null
  pubgPlayerName: string
  nickname: string
  teamId: string | null
  teamName: string
  logoUrl: string | null
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damage: number
  survivalTime: number
  placement: number | null
}

type SortKey = 'nickname' | 'teamName' | 'games' | 'kills' | 'kpg' | 'assists' | 'knocks' | 'headshotKills' | 'hsPercent' | 'damage' | 'adr' | 'avgSurvival'
type StageWithMatches = Stage & { matches: Pick<Match, 'id' | 'status' | 'order_num'>[] }
interface SeriesItem { id: string; name: string; order_num: number; tab_order: number }

function formatSurvival(totalSec: number, games: number): string {
  if (games === 0) return '—'
  const avg = totalSec / games
  const m = Math.floor(avg / 60)
  const s = Math.round(avg % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PlayerStatsTable({
  playerStats,
  stages = [],
  series = [],
  playerStatsByMatch = {},
}: {
  playerStats: PlayerStatRow[]
  stages?: StageWithMatches[]
  series?: SeriesItem[]
  playerStatsByMatch?: Record<string, PlayerMatchStat[]>
}) {
  const [sortKey, setSortKey] = useState<SortKey>('kills')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

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

  const displayStats = useMemo((): PlayerStatRow[] => {
    if (!activeMatchIds) return playerStats
    const map = new Map<string, PlayerStatRow>()
    for (const [matchId, matchStats] of Object.entries(playerStatsByMatch)) {
      if (!activeMatchIds.has(matchId)) continue
      for (const s of matchStats) {
        const key = s.playerId ?? `pubg:${s.pubgPlayerName}`
        if (!map.has(key)) {
          map.set(key, { playerId: s.playerId, nickname: s.nickname, teamId: s.teamId, teamName: s.teamName, logoUrl: s.logoUrl, games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0 })
        }
        const e = map.get(key)!
        e.games++
        e.kills += s.kills
        e.assists += s.assists
        e.knocks += s.knocks
        e.headshotKills += s.headshotKills
        e.damage += s.damage
        e.survivalTime += s.survivalTime
      }
    }
    return [...map.values()]
  }, [activeMatchIds, playerStats, playerStatsByMatch])

  const enriched = useMemo(() => displayStats.map((p) => ({
    ...p,
    kpg: p.games > 0 ? p.kills / p.games : 0,
    hsPercent: p.kills > 0 ? (p.headshotKills / p.kills) * 100 : 0,
    adr: p.games > 0 ? p.damage / p.games : 0,
    avgSurvival: p.games > 0 ? p.survivalTime / p.games : 0,
  })), [displayStats])

  const sorted = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? enriched.filter((p) => p.nickname.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q))
      : enriched
    return [...filtered].sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1
      const av = (a as Record<string, number | string>)[sortKey]
      const bv = (b as Record<string, number | string>)[sortKey]
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
  }, [enriched, sortKey, sortDir, search])

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

  if (playerStats.length === 0) {
    return <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No player data available</div>
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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

      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800">Player Stats</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="ml-auto border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-40"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
              <th onClick={() => toggleSort('nickname')} className={thLeft('nickname')}>Player{arr('nickname')}</th>
              <th onClick={() => toggleSort('teamName')} className={thLeft('teamName')}>Team{arr('teamName')}</th>
              <th onClick={() => toggleSort('games')} className={thCls('games')}>Games{arr('games')}</th>
              <th onClick={() => toggleSort('kills')} className={thCls('kills')}>Kills{arr('kills')}</th>
              <th onClick={() => toggleSort('kpg')} className={thCls('kpg')}>KPG{arr('kpg')}</th>
              <th onClick={() => toggleSort('assists')} className={thCls('assists')}>Assists{arr('assists')}</th>
              <th onClick={() => toggleSort('knocks')} className={thCls('knocks')}>Knocks{arr('knocks')}</th>
              <th onClick={() => toggleSort('headshotKills')} className={thCls('headshotKills')}>HS{arr('headshotKills')}</th>
              <th onClick={() => toggleSort('hsPercent')} className={thCls('hsPercent')}>HS%{arr('hsPercent')}</th>
              <th onClick={() => toggleSort('damage')} className={thCls('damage')}>Damage{arr('damage')}</th>
              <th onClick={() => toggleSort('adr')} className={thCls('adr')}>ADR{arr('adr')}</th>
              <th onClick={() => toggleSort('avgSurvival')} className={thCls('avgSurvival')}>Avg Surv{arr('avgSurvival')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.playerId ?? p.nickname} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-3 py-2 text-center text-gray-400">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                  {p.playerId ? (
                    <Link href={`/players/${p.playerId}`} className="hover:text-yellow-600">{p.nickname}</Link>
                  ) : p.nickname}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {p.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.logoUrl} alt="" className="w-4 h-4 rounded object-contain border border-gray-100 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded bg-gray-100 shrink-0" />
                    )}
                    {p.teamId ? (
                      <Link href={`/teams/${p.teamId}`} className="hover:text-yellow-600">{p.teamName}</Link>
                    ) : p.teamName}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-500">{p.games}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-800">{p.kills}</td>
                <td className="px-3 py-2 text-right text-gray-600">{p.kpg.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-gray-500">{p.assists}</td>
                <td className="px-3 py-2 text-right text-gray-500">{p.knocks}</td>
                <td className="px-3 py-2 text-right text-gray-500">{p.headshotKills}</td>
                <td className="px-3 py-2 text-right text-gray-500">{p.kills > 0 ? p.hsPercent.toFixed(1) + '%' : '—'}</td>
                <td className="px-3 py-2 text-right text-gray-500">{Math.round(p.damage).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-600 font-medium">{Math.round(p.adr).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-500">{formatSurvival(p.survivalTime, p.games)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
