'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

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

type SortKey = 'nickname' | 'teamName' | 'games' | 'kills' | 'kpg' | 'assists' | 'knocks' | 'headshotKills' | 'hsPercent' | 'damage' | 'adr' | 'avgSurvival'

function formatSurvival(totalSec: number, games: number): string {
  if (games === 0) return '—'
  const avg = totalSec / games
  const m = Math.floor(avg / 60)
  const s = Math.round(avg % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PlayerStatsTable({ playerStats }: { playerStats: PlayerStatRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('kills')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const enriched = useMemo(() => playerStats.map((p) => ({
    ...p,
    kpg: p.games > 0 ? p.kills / p.games : 0,
    hsPercent: p.kills > 0 ? (p.headshotKills / p.kills) * 100 : 0,
    adr: p.games > 0 ? p.damage / p.games : 0,
    avgSurvival: p.games > 0 ? p.survivalTime / p.games : 0,
  })), [playerStats])

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

  if (playerStats.length === 0) {
    return <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No player data available</div>
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                      <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
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
