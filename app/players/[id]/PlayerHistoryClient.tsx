'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import Pagination from '@/components/Pagination'
import { formatPrize } from '@/lib/currency'

interface TourEntry {
  id: string
  name: string
  short_name: string | null
  year: number | null
  tourType: string | null
  finalStageName: string | null
  finalStageRank: number | null
  finalStagePrize: number | null
  currency: string
}

interface StatRow {
  id: string
  kills: number
  assists: number
  knocks: number
  damage_dealt: number
  placement: number | null
  matchNum: number
  matchDate: string | null
  mapName: string | null
  stageId: string | null
  stageName: string | null
  seriesId: string | null
  seriesName: string | null
  tourId: string | null
  tourName: string | null
  year: number | null
  tourType: string | null
}

interface GroupedRow {
  key: string
  tourId: string | null
  tourName: string | null
  label: string
  year: number | null
  games: number
  kills: number
  assists: number
  knocks: number
  damage: number
  placements: number[]
}

type TourTypeFilter = 'all' | 'regional' | 'global'
type ViewMode = 'match' | 'stage' | 'series' | 'total'

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

export default function PlayerHistoryClient({
  tourList,
  stats,
}: {
  tourList: TourEntry[]
  stats: StatRow[]
}) {
  const years = useMemo(() => {
    const s = new Set<number>()
    tourList.forEach(t => { if (t.year) s.add(t.year) })
    stats.forEach(r => { if (r.year) s.add(r.year) })
    return [...s].sort((a, b) => b - a)
  }, [tourList, stats])

  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<TourTypeFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('match')
  const [tourPage, setTourPage] = useState(1)
  const [tourPageSize, setTourPageSize] = useState(10)
  const [matchPage, setMatchPage] = useState(1)
  const [matchPageSize, setMatchPageSize] = useState(25)

  function matchesFilter(year: number | null, tourType: string | null) {
    if (selectedYear !== 'all' && year !== selectedYear) return false
    if (typeFilter === 'regional' && tourType !== 'regional') return false
    if (typeFilter === 'global' && tourType !== 'global') return false
    return true
  }

  const filteredTours = useMemo(() => {
    const list = tourList.filter(t => matchesFilter(t.year, t.tourType))
    return list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourList, selectedYear, typeFilter])

  const filteredStats = useMemo(
    () => stats.filter(r => matchesFilter(r.year, r.tourType)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, selectedYear, typeFilter]
  )

  const groupedRows = useMemo((): GroupedRow[] => {
    if (viewMode === 'match') return []
    const map = new Map<string, GroupedRow>()
    for (const s of filteredStats) {
      let key: string
      let label: string
      if (viewMode === 'stage') {
        key = `${s.tourId ?? ''}::${s.stageId ?? s.stageName ?? ''}`
        label = s.stageName ?? '—'
      } else if (viewMode === 'series') {
        key = s.seriesId
          ? `${s.tourId ?? ''}::series::${s.seriesId}`
          : `${s.tourId ?? ''}::stage::${s.stageId ?? s.stageName ?? ''}`
        label = s.seriesName ?? s.stageName ?? '—'
      } else {
        key = s.tourId ?? 'none'
        label = s.tourName ?? '—'
      }
      if (!map.has(key)) {
        map.set(key, { key, tourId: s.tourId, tourName: s.tourName, label, year: s.year, games: 0, kills: 0, assists: 0, knocks: 0, damage: 0, placements: [] })
      }
      const g = map.get(key)!
      g.games++
      g.kills += s.kills
      g.assists += s.assists
      g.knocks += s.knocks
      g.damage += s.damage_dealt
      if (s.placement != null) g.placements.push(s.placement)
    }
    return [...map.values()].sort((a, b) => {
      if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0)
      return (a.tourName ?? '').localeCompare(b.tourName ?? '')
    })
  }, [filteredStats, viewMode])

  const totalKills = filteredStats.reduce((s, r) => s + (r.kills ?? 0), 0)
  const totalDamage = filteredStats.reduce((s, r) => s + (r.damage_dealt ?? 0), 0)
  const avgDamage = filteredStats.length > 0 ? totalDamage / filteredStats.length : 0

  const pagedTours = filteredTours.slice((tourPage - 1) * tourPageSize, tourPage * tourPageSize)
  const pagedStats = filteredStats.slice((matchPage - 1) * matchPageSize, matchPage * matchPageSize)
  const pagedGrouped = groupedRows.slice((matchPage - 1) * matchPageSize, matchPage * matchPageSize)

  const btnYear = (y: number | 'all') =>
    `px-3 py-1 text-xs rounded-lg border transition-colors ${selectedYear === y ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`
  const btnType = (t: TourTypeFilter) =>
    `px-3 py-1 text-xs rounded-lg border transition-colors ${typeFilter === t ? 'bg-gray-800 border-gray-800 text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`
  const btnView = (v: ViewMode) =>
    `px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${viewMode === v ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`

  return (
    <div>
      {/* Filter bar */}
      {years.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <button onClick={() => { setSelectedYear('all'); setTourPage(1); setMatchPage(1) }} className={btnYear('all')}>All</button>
            {years.map(y => (
              <button key={y} onClick={() => { setSelectedYear(y); setTourPage(1); setMatchPage(1) }} className={btnYear(y)}>{y}</button>
            ))}
          </div>
          <div className="flex gap-1.5 items-center">
            <button onClick={() => { setTypeFilter('all'); setTourPage(1); setMatchPage(1) }} className={btnType('all')}>Total</button>
            <button onClick={() => { setTypeFilter('regional'); setTourPage(1); setMatchPage(1) }} className={btnType('regional')}>Regional</button>
            <button onClick={() => { setTypeFilter('global'); setTourPage(1); setMatchPage(1) }} className={btnType('global')}>Global</button>
          </div>
        </div>
      )}

      {/* Career Stats */}
      {filteredStats.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Career Stats{selectedYear !== 'all' ? ` · ${selectedYear}` : ''}{typeFilter !== 'all' ? ` · ${typeFilter}` : ''}
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <StatBox label="Matches" value={filteredStats.length} />
            <StatBox label="Total Kills" value={totalKills} />
            <StatBox label="Avg Damage" value={avgDamage.toFixed(0)} />
            <StatBox label="Avg Kills" value={(totalKills / filteredStats.length).toFixed(1)} />
          </div>
        </div>
      )}

      {/* Tournament History */}
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
      {filteredTours.length === 0 ? (
        <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
      ) : (
        <div className="mb-8">
          <div className="space-y-2">
            {pagedTours.map((te) => (
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
                    {te.finalStagePrize != null && (
                      <p className="text-xs text-yellow-600 font-medium">{formatPrize(te.finalStagePrize, te.currency)}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pagination
            total={filteredTours.length}
            page={tourPage}
            pageSize={tourPageSize}
            onPageChange={setTourPage}
            onPageSizeChange={(s) => { setTourPageSize(s); setTourPage(1) }}
          />
        </div>
      )}

      {/* Match History with view mode tabs */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">Match History</h2>
        <div className="flex border-b border-gray-200">
          {(['match', 'stage', 'series', 'total'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => { setViewMode(v); setMatchPage(1) }}
              className={btnView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filteredStats.length === 0 ? (
        <p className="text-gray-400 text-sm">No match records</p>
      ) : viewMode === 'match' ? (
        <div>
          <div className="space-y-1.5">
            {pagedStats.map((s) => (
              <div key={s.id} className="bg-white rounded-lg border border-gray-200 px-4 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm min-w-0">
                    {s.tourId && (
                      <Link href={`/tournaments/${s.tourId}`} className="font-medium text-gray-800 hover:text-yellow-600 shrink-0">
                        {s.tourName}
                      </Link>
                    )}
                    {s.stageName && <span className="text-gray-300">·</span>}
                    {s.stageName && <span className="text-xs text-gray-500 shrink-0">{s.stageName}</span>}
                    {s.matchNum > 0 && <span className="text-gray-300">·</span>}
                    {s.matchNum > 0 && <span className="font-mono text-xs text-gray-500 shrink-0">M{s.matchNum}</span>}
                    {s.mapName && <span className="text-gray-300">·</span>}
                    {s.mapName && <span className="text-xs text-gray-400 shrink-0">{getMapDisplayName(s.mapName)}</span>}
                  </div>
                  <span className="text-sm font-bold text-gray-700 shrink-0 ml-4">#{s.placement}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs text-center">
                  <div><p className="text-gray-400">Kills</p><p className="font-semibold text-gray-800">{s.kills}</p></div>
                  <div><p className="text-gray-400">Assists</p><p className="font-semibold text-gray-800">{s.assists}</p></div>
                  <div><p className="text-gray-400">Knocks</p><p className="font-semibold text-gray-800">{s.knocks}</p></div>
                  <div><p className="text-gray-400">Damage</p><p className="font-semibold text-gray-800">{s.damage_dealt.toFixed(0)}</p></div>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            total={filteredStats.length}
            page={matchPage}
            pageSize={matchPageSize}
            onPageChange={setMatchPage}
            onPageSizeChange={(s) => { setMatchPageSize(s); setMatchPage(1) }}
          />
        </div>
      ) : (
        <div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {viewMode === 'total' ? 'Tournament' : viewMode === 'series' ? 'Series' : 'Stage'}
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">GP</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Kills</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">KPG</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Damage</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">ADR</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Avg Plc</th>
                </tr>
              </thead>
              <tbody>
                {pagedGrouped.map((g) => {
                  const avgPlc = g.placements.length > 0
                    ? g.placements.reduce((a, b) => a + b, 0) / g.placements.length
                    : null
                  return (
                    <tr key={g.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-2.5">
                        {viewMode !== 'total' && g.tourId ? (
                          <div>
                            <Link href={`/tournaments/${g.tourId}`} className="text-[11px] text-gray-400 hover:text-yellow-600 block">
                              {g.tourName}
                            </Link>
                            <span className="font-medium text-gray-800">{g.label}</span>
                          </div>
                        ) : g.tourId ? (
                          <Link href={`/tournaments/${g.tourId}`} className="font-medium text-gray-800 hover:text-yellow-600">
                            {g.label}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-800">{g.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{g.games}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{g.kills}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{(g.kills / g.games).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{Math.round(g.damage).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{Math.round(g.damage / g.games).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{avgPlc != null ? avgPlc.toFixed(1) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            total={groupedRows.length}
            page={matchPage}
            pageSize={matchPageSize}
            onPageChange={setMatchPage}
            onPageSizeChange={(s) => { setMatchPageSize(s); setMatchPage(1) }}
          />
        </div>
      )}
    </div>
  )
}
