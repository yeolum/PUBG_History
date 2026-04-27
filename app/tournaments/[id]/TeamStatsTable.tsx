'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'

export interface TeamStatRow {
  teamId: string | null
  teamName: string
  logoUrl: string | null
  games: number
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

type SortKey = 'teamName' | 'games' | 'totalPoints' | 'avgPlacement' | 'totalKills' | 'kpg' | 'totalDamage' | 'adr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function mapImageUrl(mapKey: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/images/maps/${encodeURIComponent(mapKey)}.jpg`
}

export default function TeamStatsTable({
  teamStats,
  dropLocations,
  mapKeys,
}: {
  teamStats: TeamStatRow[]
  dropLocations: DropLocationRow[]
  mapKeys: string[]
}) {
  const [subTab, setSubTab] = useState<'stats' | 'drops'>('stats')
  const [sortKey, setSortKey] = useState<SortKey>('totalPoints')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedMap, setSelectedMap] = useState<string>(mapKeys[0] ?? '')
  const [visibleTeams, setVisibleTeams] = useState<Set<string> | null>(null) // null = all visible

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const enriched = useMemo(() => teamStats.map((t) => ({
    ...t,
    avgPlacement: t.gamesWithPlacement > 0 ? t.placementsSum / t.gamesWithPlacement : 99,
    kpg: t.games > 0 ? t.totalKills / t.games : 0,
    adr: t.games > 0 ? t.totalDamage / t.games : 0,
  })), [teamStats])

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

  // Drop points state
  const mapsWithDrops = [...new Set(dropLocations.map((d) => d.mapName))].filter((m) => mapKeys.includes(m))
  const allDropMaps = [...new Set([...mapKeys, ...mapsWithDrops])]
  const currentMapDrops = dropLocations.filter((d) => d.mapName === selectedMap)
  const visibleDrops = visibleTeams === null ? currentMapDrops : currentMapDrops.filter((d) => visibleTeams.has(d.teamId))

  function toggleTeamVisibility(teamId: string) {
    setVisibleTeams((prev) => {
      if (prev === null) {
        // switch to selective: hide this one
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 w-8">#</th>
                  <th onClick={() => toggleSort('teamName')} className={thLeft('teamName')}>Team{arr('teamName')}</th>
                  <th onClick={() => toggleSort('games')} className={thCls('games')}>Games{arr('games')}</th>
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
                          <img src={t.logoUrl} alt="" className="w-4 h-4 rounded-full object-cover border border-gray-100 shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                        )}
                        <span className="font-medium text-gray-800">
                          {t.teamId ? (
                            <Link href={`/teams/${t.teamId}`} className="hover:text-yellow-600">{t.teamName}</Link>
                          ) : t.teamName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{t.games}</td>
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
              {/* Map tabs */}
              <div className="flex gap-1.5 flex-wrap mb-4">
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

              <div className="flex gap-4 items-start">
                {/* Map view */}
                <div className="flex-1 relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100" style={{ aspectRatio: '1' }}>
                  {/* Map image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mapImageUrl(selectedMap)}
                    alt={getMapDisplayName(selectedMap)}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {/* Grid fallback (shown when no image) */}
                  <div className="absolute inset-0 grid-pattern opacity-30" />

                  {/* No drops message */}
                  {currentMapDrops.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-400 text-xs bg-white/80 px-3 py-2 rounded-lg">이 맵의 낙하 지점 데이터가 없습니다</p>
                    </div>
                  )}

                  {/* Team logos */}
                  {visibleDrops.map((drop) => (
                    <div
                      key={drop.teamId}
                      className="absolute -translate-x-1/2 -translate-y-1/2 group"
                      style={{ left: `${drop.x * 100}%`, top: `${drop.y * 100}%` }}
                    >
                      {drop.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={drop.logoUrl}
                          alt={drop.teamName}
                          className="w-8 h-8 rounded-full border-2 border-white shadow-md object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
                          {drop.teamName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {drop.teamName}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Team filter list */}
                <div className="w-44 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Teams</p>
                    <button
                      onClick={() => setVisibleTeams(null)}
                      className="text-[11px] text-gray-400 hover:text-gray-600"
                    >
                      All
                    </button>
                  </div>
                  <div className="space-y-1 max-h-96 overflow-y-auto">
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
                              <img src={drop.logoUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-gray-300 shrink-0" />
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
