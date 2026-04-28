'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

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

interface MatchResult {
  id: string
  placement: number | null
  total_kills: number
  matchId: string | null
  matchNum: number
  mapName: string | null
  stageName: string | null
  tourId: string | null
  tourName: string | null
  year: number | null
  tourType: string | null
}

type TourTypeFilter = 'all' | 'regional' | 'global'

export default function TeamHistoryClient({
  tourList,
  matchResults,
  getMapDisplayName,
}: {
  tourList: TourEntry[]
  matchResults: MatchResult[]
  getMapDisplayName: (map: string) => string
}) {
  const years = useMemo(() => {
    const s = new Set<number>()
    tourList.forEach(t => { if (t.year) s.add(t.year) })
    matchResults.forEach(r => { if (r.year) s.add(r.year) })
    return [...s].sort((a, b) => b - a)
  }, [tourList, matchResults])

  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<TourTypeFilter>('all')

  function matchesFilter(year: number | null, tourType: string | null) {
    if (selectedYear !== 'all' && year !== selectedYear) return false
    if (typeFilter === 'regional' && tourType !== 'regional') return false
    if (typeFilter === 'global' && tourType !== 'global') return false
    return true
  }

  const filteredTours = useMemo(
    () => tourList.filter(t => matchesFilter(t.year, t.tourType)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tourList, selectedYear, typeFilter]
  )

  const filteredMatches = useMemo(
    () => matchResults.filter(r => matchesFilter(r.year, r.tourType)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchResults, selectedYear, typeFilter]
  )

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

      {/* Tournament History */}
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
      {filteredTours.length === 0 ? (
        <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
      ) : (
        <div className="space-y-2 mb-8">
          {filteredTours.map((te) => (
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
        </div>
      )}

      {/* Match History */}
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Match History</h2>
      {filteredMatches.length === 0 ? (
        <p className="text-gray-400 text-sm">No match records</p>
      ) : (
        <div className="space-y-1.5">
          {filteredMatches.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-2.5 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-1.5 text-sm min-w-0">
                {r.tourId && (
                  <Link href={`/tournaments/${r.tourId}`} className="font-medium text-gray-800 hover:text-yellow-600 shrink-0">
                    {r.tourName}
                  </Link>
                )}
                {r.stageName && <span className="text-gray-300">·</span>}
                {r.stageName && <span className="text-xs text-gray-500 shrink-0">{r.stageName}</span>}
                {r.matchNum > 0 && <span className="text-gray-300">·</span>}
                {r.matchNum > 0 && <span className="font-mono text-xs text-gray-500 shrink-0">M{r.matchNum}</span>}
                {r.mapName && <span className="text-gray-300">·</span>}
                {r.mapName && <span className="text-xs text-gray-400 shrink-0">{getMapDisplayName(r.mapName)}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-4">
                <span className="text-sm font-bold text-gray-700">#{r.placement}</span>
                <span className="text-xs text-gray-500">{r.total_kills}K</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
