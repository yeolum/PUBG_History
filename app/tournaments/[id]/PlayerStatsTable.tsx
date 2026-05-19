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
  // API-sourced additions
  walkDistance?: number
  rideDistance?: number
  longestKill?: number
  swimDistance?: number
  revives?: number
  healsUsed?: number
  boostsUsed?: number
  // Telemetry-derived
  deaths?: number
  damageTaken?: number
  blueZoneDamage?: number
  killDistanceSum?: number
  killDistanceCount?: number
  grenadesThrown?: number
  smokesThrown?: number
  flashbangsThrown?: number
  molotovsThrown?: number
  grenadeDamage?: number
  molotovDamage?: number
  grenadeHitEvents?: number
  revivesGiven?: number
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

type Category = 'combat' | 'utility' | 'survival' | 'movement' | 'teamplay'

type SortKey =
  // Combat
  | 'nickname' | 'teamName' | 'games' | 'kills' | 'kpg' | 'assists' | 'knocks'
  | 'headshotKills' | 'hsPercent' | 'damage' | 'adr' | 'longestKill' | 'avgKillDist' | 'deaths' | 'kd'
  // Utility
  | 'grenadesThrown' | 'smokesThrown' | 'flashbangsThrown' | 'molotovsThrown'
  | 'grenadeDamage' | 'molotovDamage' | 'utilityDamage' | 'grenadeHitRate'
  // Survival
  | 'avgSurvival' | 'healsUsed' | 'boostsUsed' | 'damageTaken' | 'blueZoneDamage' | 'dtr'
  // Movement
  | 'walkDistance' | 'rideDistance' | 'swimDistance' | 'totalDistance'
  // Teamplay
  | 'revivesGiven' | 'revives' | 'damageShare'

type StageWithMatches = Stage & { matches: Pick<Match, 'id' | 'status' | 'order_num'>[] }
interface SeriesItem { id: string; name: string; order_num: number; tab_order: number }

function formatSurvival(totalSec: number, games: number): string {
  if (games === 0) return '—'
  const avg = totalSec / games
  const m = Math.floor(avg / 60)
  const s = Math.round(avg % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmt(n: number | undefined, decimals = 0): string {
  if (n == null || n === 0) return '—'
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString()
}

function fmtDist(m: number | undefined): string {
  if (!m || m === 0) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

export default function PlayerStatsTable({
  playerStats,
  stagePlayerStats = {},
  seriesPlayerStats = {},
  stages = [],
  series = [],
  playerStatsByMatch = {},
}: {
  playerStats: PlayerStatRow[]
  stagePlayerStats?: Record<string, PlayerStatRow[]>
  seriesPlayerStats?: Record<string, PlayerStatRow[]>
  stages?: StageWithMatches[]
  series?: SeriesItem[]
  playerStatsByMatch?: Record<string, PlayerMatchStat[]>
}) {
  const [category, setCategory] = useState<Category>('combat')
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

  function selectTotal() { setSelectedSeriesId(null); setSelectedStageId(null); setSelectedMatchId(null) }
  function selectSeries(id: string) {
    setSelectedSeriesId(prev => prev === id ? null : id)
    setSelectedStageId(null); setSelectedMatchId(null)
  }
  function selectStage(stageId: string, seriesId: string | null = null) {
    setSelectedSeriesId(seriesId)
    setSelectedStageId(prev => prev === stageId ? null : stageId)
    setSelectedMatchId(null)
  }
  function toggleMatch(id: string) { setSelectedMatchId(prev => prev === id ? null : id) }

  function aggregateFromMatches(matchIds: Set<string>): PlayerStatRow[] {
    const map = new Map<string, PlayerStatRow>()
    for (const [matchId, matchStats] of Object.entries(playerStatsByMatch)) {
      if (!matchIds.has(matchId)) continue
      for (const s of matchStats) {
        const key = s.playerId ?? `pubg:${s.pubgPlayerName}`
        if (!map.has(key)) map.set(key, { playerId: s.playerId, nickname: s.nickname, teamId: s.teamId, teamName: s.teamName, logoUrl: s.logoUrl, games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0 })
        const e = map.get(key)!
        e.games++; e.kills += s.kills; e.assists += s.assists; e.knocks += s.knocks
        e.headshotKills += s.headshotKills; e.damage += s.damage; e.survivalTime += s.survivalTime
      }
    }
    return [...map.values()]
  }

  const displayStats = useMemo((): PlayerStatRow[] => {
    if (selectedMatchId) {
      const map = new Map<string, PlayerStatRow>()
      for (const s of playerStatsByMatch[selectedMatchId] ?? []) {
        const key = s.playerId ?? `pubg:${s.pubgPlayerName}`
        if (!map.has(key)) map.set(key, { playerId: s.playerId, nickname: s.nickname, teamId: s.teamId, teamName: s.teamName, logoUrl: s.logoUrl, games: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0 })
        const e = map.get(key)!
        e.games++; e.kills += s.kills; e.assists += s.assists; e.knocks += s.knocks
        e.headshotKills += s.headshotKills; e.damage += s.damage; e.survivalTime += s.survivalTime
      }
      return [...map.values()]
    }
    if (selectedStageId) {
      const precomputed = stagePlayerStats[selectedStageId]
      if (precomputed && precomputed.length > 0) return precomputed
      const stage = stages.find(s => s.id === selectedStageId)
      return aggregateFromMatches(new Set(stage?.matches.filter(m => m.status === 'imported').map(m => m.id) ?? []))
    }
    if (selectedSeriesId) {
      const precomputed = seriesPlayerStats[selectedSeriesId]
      if (precomputed && precomputed.length > 0) return precomputed
      const ids = stages.filter(s => s.series_id === selectedSeriesId).flatMap(s => s.matches.filter(m => m.status === 'imported').map(m => m.id))
      return aggregateFromMatches(new Set(ids))
    }
    return playerStats
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMatchId, selectedStageId, selectedSeriesId, playerStats, stagePlayerStats, seriesPlayerStats, playerStatsByMatch, stages])

  // Team totals for damage share calculation
  const teamDamageTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of displayStats) {
      if (!p.teamId) continue
      m.set(p.teamId, (m.get(p.teamId) ?? 0) + p.damage)
    }
    return m
  }, [displayStats])

  const enriched = useMemo(() => displayStats.map((p) => ({
    ...p,
    kpg: p.games > 0 ? p.kills / p.games : 0,
    hsPercent: p.kills > 0 ? (p.headshotKills / p.kills) * 100 : 0,
    adr: p.games > 0 ? p.damage / p.games : 0,
    avgSurvival: p.games > 0 ? p.survivalTime / p.games : 0,
    kd: (p.deaths ?? 0) > 0 ? p.kills / (p.deaths ?? 1) : p.kills,
    avgKillDist: (p.killDistanceCount ?? 0) > 0 ? (p.killDistanceSum ?? 0) / (p.killDistanceCount ?? 1) : 0,
    utilityDamage: (p.grenadeDamage ?? 0) + (p.molotovDamage ?? 0),
    grenadeHitRate: (p.grenadesThrown ?? 0) + (p.molotovsThrown ?? 0) + (p.flashbangsThrown ?? 0) > 0
      ? ((p.grenadeHitEvents ?? 0) / ((p.grenadesThrown ?? 0) + (p.molotovsThrown ?? 0) + (p.flashbangsThrown ?? 0))) * 100
      : 0,
    dtr: (p.damageTaken ?? 0) > 0 ? p.damage / (p.damageTaken ?? 1) : 0,
    totalDistance: (p.walkDistance ?? 0) + (p.rideDistance ?? 0) + (p.swimDistance ?? 0),
    damageShare: p.teamId && (teamDamageTotal.get(p.teamId) ?? 0) > 0
      ? (p.damage / (teamDamageTotal.get(p.teamId) ?? 1)) * 100
      : 0,
    revivesGiven: p.revivesGiven ?? 0,
    revives: p.revives ?? 0,
    grenadesThrown: p.grenadesThrown ?? 0,
    smokesThrown: p.smokesThrown ?? 0,
    flashbangsThrown: p.flashbangsThrown ?? 0,
    molotovsThrown: p.molotovsThrown ?? 0,
    grenadeDamage: p.grenadeDamage ?? 0,
    molotovDamage: p.molotovDamage ?? 0,
    longestKill: p.longestKill ?? 0,
    deaths: p.deaths ?? 0,
    damageTaken: p.damageTaken ?? 0,
    blueZoneDamage: p.blueZoneDamage ?? 0,
    healsUsed: p.healsUsed ?? 0,
    boostsUsed: p.boostsUsed ?? 0,
    walkDistance: p.walkDistance ?? 0,
    rideDistance: p.rideDistance ?? 0,
    swimDistance: p.swimDistance ?? 0,
  })), [displayStats, teamDamageTotal])

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
      if (sortKey === 'avgSurvival') return -dir * ((av as number) - (bv as number))
      return dir * ((av as number) - (bv as number))
    })
  }, [enriched, sortKey, sortDir, search])

  const thR = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      className={`px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-700 transition-colors ${sortKey === key ? 'text-yellow-600' : 'text-gray-400'}`}
    >
      {label}{sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )
  const thL = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-700 transition-colors ${sortKey === key ? 'text-yellow-600' : 'text-gray-400'}`}
    >
      {label}{sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const scopeBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-lg border transition-colors ${active ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`
  const matchBtn = (active: boolean) =>
    `min-w-[28px] px-2 py-1 text-xs font-mono rounded border transition-colors ${active ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`
  const catBtn = (cat: Category) =>
    `px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${category === cat ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`

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

  if (playerStats.length === 0 && Object.keys(playerStatsByMatch).length === 0) {
    return <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No player data available</div>
  }

  const playerTeamCell = (p: typeof sorted[0], i: number) => (
    <>
      <td className="px-3 py-2 text-center text-gray-400 shrink-0">{i + 1}</td>
      <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
        {p.playerId ? <Link href={`/players/${p.playerId}`} className="hover:text-yellow-600">{p.nickname}</Link> : p.nickname}
      </td>
      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {p.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.logoUrl} alt="" className="w-4 h-4 rounded object-contain border border-gray-100 shrink-0" />
            : <span className="w-4 h-4 rounded bg-gray-100 shrink-0" />}
          {p.teamId ? <Link href={`/teams/${p.teamId}`} className="hover:text-yellow-600">{p.teamName}</Link> : p.teamName}
        </div>
      </td>
      <td className="px-3 py-2 text-right text-gray-500">{p.games}</td>
    </>
  )

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
                <button key={s.id} onClick={() => selectStage(s.id, selectedSeriesId)} className={scopeBtn(selectedStageId === s.id)}>{s.name}</button>
              ))}
            </div>
          )}
          {currentStageMatches.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-gray-200">
              {currentStageMatches.map((m, i) => (
                <button key={m.id} onClick={() => toggleMatch(m.id)} className={matchBtn(selectedMatchId === m.id)}>M{i + 1}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category tabs + search */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50/50 px-2 gap-1 overflow-x-auto">
        <button onClick={() => { setCategory('combat'); setSortKey('kills') }} className={catBtn('combat')}>Combat</button>
        <button onClick={() => { setCategory('utility'); setSortKey('grenadeDamage') }} className={catBtn('utility')}>Utility</button>
        <button onClick={() => { setCategory('survival'); setSortKey('avgSurvival') }} className={catBtn('survival')}>Survival</button>
        <button onClick={() => { setCategory('movement'); setSortKey('totalDistance') }} className={catBtn('movement')}>Movement</button>
        <button onClick={() => { setCategory('teamplay'); setSortKey('revivesGiven') }} className={catBtn('teamplay')}>Teamplay</button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="ml-auto border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-36 shrink-0 my-1.5"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {category === 'combat' && (
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                {thL('nickname', 'Player')}
                {thL('teamName', 'Team')}
                {thR('games', 'G')}
                {thR('kills', 'Kills')}
                {thR('kpg', 'KPG')}
                {thR('deaths', 'Deaths')}
                {thR('kd', 'K/D')}
                {thR('assists', 'Assists')}
                {thR('knocks', 'Knocks')}
                {thR('headshotKills', 'HS')}
                {thR('hsPercent', 'HS%')}
                {thR('damage', 'Damage')}
                {thR('adr', 'ADR')}
                {thR('longestKill', 'Longest Kill')}
                {thR('avgKillDist', 'Avg Kill Dist')}
              </tr>
            )}
            {category === 'utility' && (
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                {thL('nickname', 'Player')}
                {thL('teamName', 'Team')}
                {thR('games', 'G')}
                {thR('grenadesThrown', 'Grenades')}
                {thR('smokesThrown', 'Smokes')}
                {thR('flashbangsThrown', 'Flashes')}
                {thR('molotovsThrown', 'Molotovs')}
                {thR('grenadeDamage', 'Nade Dmg')}
                {thR('molotovDamage', 'Molotov Dmg')}
                {thR('utilityDamage', 'Util Dmg')}
                {thR('grenadeHitRate', 'Hit Rate')}
              </tr>
            )}
            {category === 'survival' && (
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                {thL('nickname', 'Player')}
                {thL('teamName', 'Team')}
                {thR('games', 'G')}
                {thR('avgSurvival', 'Avg Surv')}
                {thR('deaths', 'Deaths')}
                {thR('damageTaken', 'Dmg Taken')}
                {thR('blueZoneDamage', 'BZ Dmg')}
                {thR('dtr', 'DD/DT')}
                {thR('healsUsed', 'Heals')}
                {thR('boostsUsed', 'Boosts')}
                {thR('revives', 'Revived')}
              </tr>
            )}
            {category === 'movement' && (
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                {thL('nickname', 'Player')}
                {thL('teamName', 'Team')}
                {thR('games', 'G')}
                {thR('walkDistance', 'Walk')}
                {thR('rideDistance', 'Ride')}
                {thR('swimDistance', 'Swim')}
                {thR('totalDistance', 'Total')}
              </tr>
            )}
            {category === 'teamplay' && (
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                {thL('nickname', 'Player')}
                {thL('teamName', 'Team')}
                {thR('games', 'G')}
                {thR('assists', 'Assists')}
                {thR('knocks', 'Knocks')}
                {thR('revivesGiven', 'Revives Given')}
                {thR('revives', 'Revived')}
                {thR('damageShare', 'Dmg Share')}
              </tr>
            )}
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={16} className="px-3 py-10 text-center text-gray-400 text-sm">No data for this scope</td></tr>
            )}
            {sorted.map((p, i) => (
              <tr key={p.playerId ?? p.nickname} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                {category === 'combat' && (
                  <>
                    {playerTeamCell(p, i)}
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">{p.kills}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{p.kpg.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.deaths}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{p.deaths > 0 ? p.kd.toFixed(2) : p.kills}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.assists}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.knocks}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.headshotKills}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.kills > 0 ? p.hsPercent.toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{Math.round(p.damage).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-700">{Math.round(p.adr).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.longestKill > 0 ? `${Math.round(p.longestKill)}m` : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.avgKillDist > 0 ? `${Math.round(p.avgKillDist)}m` : '—'}</td>
                  </>
                )}
                {category === 'utility' && (
                  <>
                    {playerTeamCell(p, i)}
                    <td className="px-3 py-2 text-right text-gray-700 font-medium">{fmt(p.grenadesThrown)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.smokesThrown)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.flashbangsThrown)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.molotovsThrown)}</td>
                    <td className="px-3 py-2 text-right text-gray-700 font-medium">{p.grenadeDamage > 0 ? Math.round(p.grenadeDamage).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.molotovDamage > 0 ? Math.round(p.molotovDamage).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.utilityDamage > 0 ? Math.round(p.utilityDamage).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.grenadeHitRate > 0 ? p.grenadeHitRate.toFixed(1) + '%' : '—'}</td>
                  </>
                )}
                {category === 'survival' && (
                  <>
                    {playerTeamCell(p, i)}
                    <td className="px-3 py-2 text-right text-gray-700 font-medium">{formatSurvival(p.survivalTime, p.games)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.deaths}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.damageTaken > 0 ? Math.round(p.damageTaken).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.blueZoneDamage > 0 ? Math.round(p.blueZoneDamage).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.damageTaken > 0 ? p.dtr.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.healsUsed)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.boostsUsed)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(p.revives)}</td>
                  </>
                )}
                {category === 'movement' && (
                  <>
                    {playerTeamCell(p, i)}
                    <td className="px-3 py-2 text-right text-gray-500">{fmtDist(p.walkDistance)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtDist(p.rideDistance)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtDist(p.swimDistance)}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-700">{fmtDist(p.totalDistance)}</td>
                  </>
                )}
                {category === 'teamplay' && (
                  <>
                    {playerTeamCell(p, i)}
                    <td className="px-3 py-2 text-right text-gray-700 font-medium">{p.assists}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.knocks}</td>
                    <td className="px-3 py-2 text-right text-gray-700 font-medium">{p.revivesGiven > 0 ? p.revivesGiven : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.revives > 0 ? p.revives : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{p.damageShare > 0 ? p.damageShare.toFixed(1) + '%' : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
