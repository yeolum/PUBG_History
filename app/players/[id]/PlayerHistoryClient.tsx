'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'

interface TourEntry {
  id: string
  name: string
  short_name: string | null
  year: number | null
  tourType: string | null
  finalStageName: string | null
  finalStageRank: number | null
  finalStagePrize: string | null
}

interface StatRow {
  id: string
  kills: number
  assists: number
  knocks: number
  damage_dealt: number
  placement: number | null
  matchNum: number
  mapName: string | null
  stageName: string | null
  tourId: string | null
  tourName: string | null
  year: number | null
  tourType: string | null
}

type TourTypeFilter = 'all' | 'regional' | 'global'

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function LimitButtons({ limit, setLimit }: { limit: number; setLimit: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[10, 20, 30].map(n => (
        <button
          key={n}
          onClick={() => setLimit(n)}
          className={`px-2 py-0.5 text-xs rounded border transition-colors ${limit === n ? 'bg-gray-800 border-gray-800 text-white font-semibold' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'}`}
        >
          {n}
        </button>
      ))}
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
  const [tourLimit, setTourLimit] = useState(10)
  const [matchLimit, setMatchLimit] = useState(20)

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

  const totalKills = filteredStats.reduce((s, r) => s + (r.kills ?? 0), 0)
  const totalDamage = filteredStats.reduce((s, r) => s + (r.damage_dealt ?? 0), 0)
  const avgDamage = filteredStats.length > 0 ? totalDamage / filteredStats.length : 0

  const btnYear = (y: number | 'all') =>
    `px-3 py-1 text-xs rounded-lg border transition-colors ${selectedYear === y ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`
  const btnType = (t: TourTypeFilter) =>
    `px-3 py-1 text-xs rounded-lg border transition-colors ${typeFilter === t ? 'bg-gray-800 border-gray-800 text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`

  return (
    <div>
      {/* Filter bar */}
      {years.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <button onClick={() => setSelectedYear('all')} className={btnYear('all')}>All</button>
            {years.map(y => (
              <button key={y} onClick={() => setSelectedYear(y)} className={btnYear(y)}>{y}</button>
            ))}
          </div>
          <div className="flex gap-1.5 items-center">
            <button onClick={() => setTypeFilter('all')} className={btnType('all')}>Total</button>
            <button onClick={() => setTypeFilter('regional')} className={btnType('regional')}>Regional</button>
            <button onClick={() => setTypeFilter('global')} className={btnType('global')}>Global</button>
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Tournament History</h2>
        <LimitButtons limit={tourLimit} setLimit={setTourLimit} />
      </div>
      {filteredTours.length === 0 ? (
        <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
      ) : (
        <div className="space-y-2 mb-8">
          {filteredTours.slice(0, tourLimit).map((te) => (
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
                  {te.finalStagePrize && (
                    <p className="text-xs text-yellow-600 font-medium">{te.finalStagePrize}</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredTours.length > tourLimit && (
            <p className="text-xs text-gray-400 text-center pt-1">+{filteredTours.length - tourLimit} more</p>
          )}
        </div>
      )}

      {/* Match History */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Match History</h2>
        <LimitButtons limit={matchLimit} setLimit={setMatchLimit} />
      </div>
      {filteredStats.length === 0 ? (
        <p className="text-gray-400 text-sm">No match records</p>
      ) : (
        <div className="space-y-1.5">
          {filteredStats.slice(0, matchLimit).map((s) => (
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
                <div>
                  <p className="text-gray-400">Kills</p>
                  <p className="font-semibold text-gray-800">{s.kills}</p>
                </div>
                <div>
                  <p className="text-gray-400">Assists</p>
                  <p className="font-semibold text-gray-800">{s.assists}</p>
                </div>
                <div>
                  <p className="text-gray-400">Knocks</p>
                  <p className="font-semibold text-gray-800">{s.knocks}</p>
                </div>
                <div>
                  <p className="text-gray-400">Damage</p>
                  <p className="font-semibold text-gray-800">{s.damage_dealt.toFixed(0)}</p>
                </div>
              </div>
            </div>
          ))}
          {filteredStats.length > matchLimit && (
            <p className="text-xs text-gray-400 text-center pt-1">+{filteredStats.length - matchLimit} more</p>
          )}
        </div>
      )}
    </div>
  )
}
