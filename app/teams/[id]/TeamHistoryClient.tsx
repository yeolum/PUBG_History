'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import Pagination from '@/components/Pagination'
import { formatPrize } from '@/lib/currency'

interface SubTeamResult {
  teamId: string
  teamName: string
  rank: number | null
  rankLabel: string | null
  prize: number | null
}

interface TourEntry {
  id: string
  name: string
  short_name: string | null
  year: number | null
  tourType: string | null
  bannerUrl: string | null
  startDate: string | null
  endDate: string | null
  finalStageRank: number | null
  finalStageRankLabel: string | null
  finalStagePrize: number | null
  currency: string
  subTeamResults: SubTeamResult[]
}

interface MatchResult {
  id: string
  placement: number | null
  total_kills: number
  total_damage: number
  matchId: string | null
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
  subTeamName: string | null
}

interface RosterPlayer {
  id: string
  nickname: string
}

interface GroupedRow {
  key: string
  tourId: string | null
  tourName: string | null
  label: string
  year: number | null
  games: number
  wwcd: number
  kills: number
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

export default function TeamHistoryClient({
  tourList,
  matchResults,
  isPnc = false,
  tourRosters = {},
}: {
  tourList: TourEntry[]
  matchResults: MatchResult[]
  isPnc?: boolean
  tourRosters?: Record<string, RosterPlayer[]>
}) {
  const years = useMemo(() => {
    const s = new Set<number>()
    tourList.forEach(t => { if (t.year) s.add(t.year) })
    matchResults.forEach(r => { if (r.year) s.add(r.year) })
    return [...s].sort((a, b) => b - a)
  }, [tourList, matchResults])

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
    return list.sort((a, b) => {
      const aDate = a.endDate ?? a.startDate ?? ''
      const bDate = b.endDate ?? b.startDate ?? ''
      if (bDate !== aDate) return bDate > aDate ? 1 : -1
      return (a.name ?? '').localeCompare(b.name ?? '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourList, selectedYear, typeFilter])

  const filteredMatches = useMemo(
    () => matchResults.filter(r => matchesFilter(r.year, r.tourType)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchResults, selectedYear, typeFilter]
  )

  const groupedRows = useMemo((): GroupedRow[] => {
    if (viewMode === 'match') return []
    const map = new Map<string, GroupedRow>()
    for (const r of filteredMatches) {
      let key: string
      let label: string
      if (viewMode === 'stage') {
        key = `${r.tourId ?? ''}::${r.stageId ?? r.stageName ?? ''}`
        label = r.stageName ?? '—'
      } else if (viewMode === 'series') {
        key = r.seriesId
          ? `${r.tourId ?? ''}::series::${r.seriesId}`
          : `${r.tourId ?? ''}::stage::${r.stageId ?? r.stageName ?? ''}`
        label = r.seriesName ?? r.stageName ?? '—'
      } else {
        key = r.tourId ?? 'none'
        label = r.tourName ?? '—'
      }
      if (!map.has(key)) {
        map.set(key, { key, tourId: r.tourId, tourName: r.tourName, label, year: r.year, games: 0, wwcd: 0, kills: 0, damage: 0, placements: [] })
      }
      const g = map.get(key)!
      g.games++
      g.kills += r.total_kills
      g.damage += r.total_damage
      if (r.placement === 1) g.wwcd++
      if (r.placement != null) g.placements.push(r.placement)
    }
    return [...map.values()].sort((a, b) => {
      if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0)
      return (a.tourName ?? '').localeCompare(b.tourName ?? '')
    })
  }, [filteredMatches, viewMode])

  const totalMatches = filteredMatches.length
  const wwcd = filteredMatches.filter(r => r.placement === 1).length
  const totalKills = filteredMatches.reduce((s, r) => s + (r.total_kills ?? 0), 0)
  const totalDamage = filteredMatches.reduce((s, r) => s + (r.total_damage ?? 0), 0)
  const avgDamage = totalMatches > 0 ? totalDamage / totalMatches : 0
  const placedMatches = filteredMatches.filter(r => r.placement != null)
  const avgPlacement = placedMatches.length > 0
    ? placedMatches.reduce((s, r) => s + (r.placement ?? 0), 0) / placedMatches.length
    : 0

  const pagedTours = filteredTours.slice((tourPage - 1) * tourPageSize, tourPage * tourPageSize)
  const pagedMatches = filteredMatches.slice((matchPage - 1) * matchPageSize, matchPage * matchPageSize)
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
          {!isPnc && (
            <div className="flex gap-1.5 items-center">
              <button onClick={() => { setTypeFilter('all'); setTourPage(1); setMatchPage(1) }} className={btnType('all')}>Total</button>
              <button onClick={() => { setTypeFilter('regional'); setTourPage(1); setMatchPage(1) }} className={btnType('regional')}>Regional</button>
              <button onClick={() => { setTypeFilter('global'); setTourPage(1); setMatchPage(1) }} className={btnType('global')}>Global</button>
            </div>
          )}
        </div>
      )}

      {/* Career Stats */}
      {totalMatches > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Career Stats{selectedYear !== 'all' ? ` · ${selectedYear}` : ''}{!isPnc && typeFilter !== 'all' ? ` · ${typeFilter}` : ''}
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <StatBox label="Matches" value={totalMatches} />
            <StatBox label="Total Kills" value={totalKills} />
            <StatBox label="Avg Damage" value={avgDamage.toFixed(0)} />
            <StatBox label="Avg Kills" value={totalMatches > 0 ? (totalKills / totalMatches).toFixed(1) : '-'} />
          </div>
        </div>
      )}

      {/* PNC: Tournament blocks with roster */}
      {isPnc ? (
        <>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
          {filteredTours.length === 0 ? (
            <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
          ) : (
            <div className="mb-10">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {pagedTours.map((te) => {
                  const roster = tourRosters[te.id] ?? []
                  return (
                    <div key={te.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <Link href={`/tournaments/${te.id}`} className="flex items-center gap-1.5 text-sm font-bold text-gray-900 hover:text-yellow-600 truncate min-w-0">
                          {te.bannerUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={te.bannerUrl} alt="" className="w-5 h-5 rounded object-contain border border-gray-100 shrink-0" />
                          )}
                          <span className="truncate">{te.short_name ?? te.name}</span>
                        </Link>
                        {te.finalStageRankLabel === 'DQ' ? (
                          <span className="text-xs font-bold text-red-500 shrink-0">DQ</span>
                        ) : te.finalStageRank != null ? (
                          <span className="text-base font-bold text-yellow-500 shrink-0">#{te.finalStageRank}</span>
                        ) : null}
                      </div>
                      {te.subTeamResults.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {te.subTeamResults.map((sr) => (
                            <span key={sr.teamId} className="inline-flex items-center gap-0.5 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium">
                              {sr.teamName}
                              {sr.rankLabel === 'DQ' ? (
                                <span className="text-red-500 font-bold ml-0.5">DQ</span>
                              ) : sr.rank != null ? (
                                <span className="text-gray-800 font-bold ml-0.5">#{sr.rank}</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}
                      {(te.startDate || te.endDate) && (
                        <p className="text-[11px] text-gray-400 mb-2">{te.startDate ?? '?'} ~ {te.endDate ?? '?'}</p>
                      )}
                      {te.finalStagePrize != null && (
                        <p className="text-xs text-yellow-600 font-medium mb-2">{formatPrize(te.finalStagePrize, te.currency)}</p>
                      )}
                      {roster.length > 0 && (
                        <div className="border-t border-gray-100 pt-2 space-y-1">
                          {roster.map(p => (
                            <Link key={p.id} href={`/players/${p.id}`} className="block text-xs text-gray-700 hover:text-yellow-600 truncate">
                              {p.nickname}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
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
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Tournament History</h2>
          {filteredTours.length === 0 ? (
            <p className="text-gray-400 text-sm mb-8">No tournament results recorded</p>
          ) : (
            <div className="mb-8">
              <div className="space-y-2">
                {pagedTours.map((te) => (
                  <div key={te.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2">
                      {te.bannerUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={te.bannerUrl} alt="" className="w-6 h-6 rounded object-contain border border-gray-100 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link href={`/tournaments/${te.id}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600 truncate block">
                          {te.short_name ?? te.name}
                        </Link>
                        {(te.startDate || te.endDate) && (
                          <p className="text-[11px] text-gray-400 mt-0.5">{te.startDate ?? '?'} ~ {te.endDate ?? '?'}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {te.finalStageRankLabel === 'DQ' ? (
                        <p className="text-sm font-bold text-red-500">DQ</p>
                      ) : te.finalStageRank != null ? (
                        <>
                          <p className="text-base font-bold text-gray-900">#{te.finalStageRank}</p>
                          {te.finalStagePrize != null && (
                            <p className="text-xs text-yellow-600 font-medium">{formatPrize(te.finalStagePrize, te.currency)}</p>
                          )}
                        </>
                      ) : null}
                      {te.subTeamResults.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1 mt-0.5">
                          {te.subTeamResults.map((sr) => (
                            <span key={sr.teamId} className="inline-flex items-center gap-0.5 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium">
                              {sr.teamName}
                              {sr.rankLabel === 'DQ' ? (
                                <span className="text-red-500 font-bold ml-0.5">DQ</span>
                              ) : sr.rank != null ? (
                                <span className="text-gray-800 font-bold ml-0.5">#{sr.rank}</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
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
        </>
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

      {filteredMatches.length === 0 ? (
        <p className="text-gray-400 text-sm">No match records</p>
      ) : viewMode === 'match' ? (
        <div>
          <div className="space-y-1">
            {pagedMatches.map((r) => (
              <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {r.subTeamName && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5 font-medium">{r.subTeamName}</span>
                    )}
                    {r.tourId ? (
                      <Link href={`/tournaments/${r.tourId}`} className="font-medium text-gray-800 hover:text-yellow-600">{r.tourName}</Link>
                    ) : null}
                    {r.stageName && <><span className="text-gray-300">·</span><span className="text-gray-500">{r.stageName}</span></>}
                    {r.matchNum > 0 && <><span className="text-gray-300">·</span><span className="font-mono text-gray-500">M{r.matchNum}</span></>}
                  </div>
                  {r.mapName && <p className="text-[11px] text-gray-400 mt-0.5">{getMapDisplayName(r.mapName)}</p>}
                </div>
                <div className="flex items-center gap-4 shrink-0 text-xs">
                  <div className="text-center w-8">
                    <p className="text-[10px] text-gray-400">Rank</p>
                    <p className="font-bold text-gray-900">{r.placement != null ? `#${r.placement}` : '—'}</p>
                  </div>
                  <div className="text-center w-7">
                    <p className="text-[10px] text-gray-400">Kills</p>
                    <p className="font-semibold text-gray-700">{r.total_kills}</p>
                  </div>
                  <div className="text-center w-16">
                    <p className="text-[10px] text-gray-400">Dmg</p>
                    <p className="font-semibold text-gray-700">{Math.round(r.total_damage).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            total={filteredMatches.length}
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
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">WWCD</th>
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
                      <td className="px-3 py-2.5 text-right text-gray-500">{g.wwcd}</td>
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
