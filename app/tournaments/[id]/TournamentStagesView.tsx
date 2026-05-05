'use client'

import { useState, useMemo, Fragment } from 'react'
import Link from 'next/link'
import MatchStageView from './MatchStageView'
import { stripTagPrefix } from '@/lib/pubg-api'
import type { Stage, Match } from '@/lib/types'
import { calcPlacementPtsWithRule, ruleFromStage } from '@/lib/scoring'
import { formatPrize } from '@/lib/currency'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

interface SeriesItem { id: string; name: string; order_num: number; tab_order: number; advance_count: number | null; eliminate_count: number | null }
interface RankEntry { rank: number; teamId: string | null; teamName: string }
interface PrizeConfigItem { rank: number; prize: number | null; pgs_points: number | null; pgc_points: number | null }
interface SpecialAwardItem { id: string; awardName: string; playerId: string | null; playerName: string | null; prize: number | null; pgsPoints: number | null; pgcPoints: number | null }
interface CombinedItem { id: string; name: string; order_num: number; tab_order: number; advance_count: number | null; eliminate_count: number | null; stageIds: string[] }
interface CombinedStanding { teamId: string | null; teamName: string; matches: number; wwcd: number; placePts: number; killPts: number; totalPts: number }

interface Props {
  stages: (Stage & { matches: Match[] })[]
  series: SeriesItem[]
  combined?: CombinedItem[]
  combinedStandings?: Record<string, CombinedStanding[]>
  resultsByMatch: Record<string, AnyObj[]>
  damageByMatch: Record<string, { placement: number; damage_dealt: number }[]>
  rankBoard: RankEntry[]
  prizeConfig: PrizeConfigItem[]
  hasPrize: boolean
  hasPgsPoints: boolean
  hasPgcPoints: boolean
  currency: string
  aliasLogoLookup: Record<string, string | null>
  stageAdditionalPts?: Record<string, Record<string, number>>
  wwcdBonusByTeamId?: Record<string, { prize: number; pgs: number; pgc: number }>
  specialAwards?: SpecialAwardItem[]
  dqTeamIds?: Set<string>
}

const rankStyle = (rank: number) =>
  rank === 1 ? 'text-yellow-500 font-bold' :
  rank === 2 ? 'text-gray-400 font-semibold' :
  rank === 3 ? 'text-amber-600 font-semibold' : 'text-gray-300'

function resolveLogoUrl(teamId: string | null, name: string, lookup: Record<string, string | null>): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function TournamentStagesView({
  stages, series, combined = [], combinedStandings = {},
  resultsByMatch, damageByMatch, rankBoard, prizeConfig,
  hasPrize, hasPgsPoints, hasPgcPoints, currency, aliasLogoLookup, stageAdditionalPts = {},
  wwcdBonusByTeamId = {}, specialAwards = [], dqTeamIds = new Set(),
}: Props) {
  // All hooks must be before early return
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [selectedCombinedId, setSelectedCombinedId] = useState<string | null>(null)

  const stagesBySeries = useMemo(() => {
    const map = new Map<string, (Stage & { matches: Match[] })[]>()
    for (const stage of stages) {
      if (stage.series_id) {
        if (!map.has(stage.series_id)) map.set(stage.series_id, [])
        map.get(stage.series_id)!.push(stage)
      }
    }
    return map
  }, [stages])

  const directStages = useMemo(
    () => stages.filter(s => !s.series_id),
    [stages]
  )

  const selectedStage = useMemo(
    () => selectedStageId ? stages.find(s => s.id === selectedStageId) ?? null : null,
    [selectedStageId, stages]
  )

  // matchId → ScoringRuleConfig lookup
  const matchToRule = useMemo(() => {
    const map = new Map<string, ReturnType<typeof ruleFromStage>>()
    for (const stage of stages) {
      const rule = ruleFromStage(stage.scoring_rules)
      for (const m of stage.matches) map.set(m.id, rule)
    }
    return map
  }, [stages])

  // Series combined standings (when series selected, no stage drilled)
  const seriesStandings = useMemo(() => {
    if (!selectedSeriesId || selectedStageId) return []
    const seriesStages = stages.filter(s => s.series_id === selectedSeriesId)
    const seriesMatchIds = new Set(seriesStages.flatMap(s => s.matches.filter(m => m.status === 'imported').map(m => m.id)))
    const ptsMap = new Map<string, { teamId: string | null; teamName: string; totalPts: number; placePts: number; matches: number; wwcd: number }>()
    for (const [matchId, results] of Object.entries(resultsByMatch)) {
      if (!seriesMatchIds.has(matchId)) continue
      const rule = matchToRule.get(matchId)!
      for (const r of results as AnyObj[]) {
        const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
        if (!ptsMap.has(key)) {
          ptsMap.set(key, { teamId: r.team_id ?? null, teamName: r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '?'), totalPts: 0, placePts: 0, matches: 0, wwcd: 0 })
        }
        const e = ptsMap.get(key)!
        const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
        const kills = Math.round((r.total_kills ?? 0) * rule.kill_pts)
        e.totalPts += pp + kills
        e.placePts += pp
        e.matches++
        if ((r.placement ?? 99) === 1) e.wwcd++
      }
    }
    // Apply additional points from all stages in this series
    const seriesStageIds = seriesStages.map(s => s.id)
    for (const e of ptsMap.values()) {
      for (const stageId of seriesStageIds) {
        e.totalPts += stageAdditionalPts[stageId]?.[e.teamName.toLowerCase()] ?? 0
      }
    }
    return [...ptsMap.values()].sort((a, b) => b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts)
  }, [selectedSeriesId, selectedStageId, stages, resultsByMatch, matchToRule, stageAdditionalPts])

  // Per-match results for series view
  const seriesMatchResults = useMemo(() => {
    if (!selectedMatchId || selectedStageId) return []
    const rule = matchToRule.get(selectedMatchId) ?? ruleFromStage(null)
    return (resultsByMatch[selectedMatchId] ?? [] as AnyObj[])
      .map((r: AnyObj) => {
        const placementPts = calcPlacementPtsWithRule(r.placement ?? 99, rule)
        const killPts = Math.round((r.total_kills ?? 0) * rule.kill_pts)
        return { ...r, placementPts, killPts, matchPts: placementPts + killPts }
      })
      .sort((a: AnyObj, b: AnyObj) => b.matchPts !== a.matchPts ? b.matchPts - a.matchPts : (a.placement ?? 99) - (b.placement ?? 99))
  }, [selectedMatchId, selectedStageId, resultsByMatch, matchToRule])

  // Stage match buttons (when stage selected)
  const stageLevelMatches = useMemo(
    () => selectedStage ? [...selectedStage.matches].filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num) : [],
    [selectedStage]
  )

  const stageMatchGroups = useMemo(() => {
    const groups: { date: string; label: string; matches: Match[] }[] = []
    for (const match of stageLevelMatches) {
      const date = match.match_date ? match.match_date.split('T')[0] : ''
      const existing = groups.find(g => g.date === date)
      if (existing) existing.matches.push(match)
      else groups.push({ date, label: date ? formatDateLabel(date) : '', matches: [match] })
    }
    return groups
  }, [stageLevelMatches])

  // Series-level stages (when series selected, no stage)
  const seriesLevelStages = useMemo(
    () => selectedSeriesId && !selectedStageId ? stages.filter(s => s.series_id === selectedSeriesId) : [],
    [selectedSeriesId, selectedStageId, stages]
  )

  // Tournament-wide team stats for the initial Final Standings view
  const overallStandingsMap = useMemo(() => {
    const map = new Map<string, { matches: number; wwcd: number; placePts: number; kills: number; totalPts: number }>()
    for (const [matchId, results] of Object.entries(resultsByMatch)) {
      const rule = matchToRule.get(matchId)
      if (!rule) continue
      for (const r of results as AnyObj[]) {
        const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
        if (!map.has(key)) map.set(key, { matches: 0, wwcd: 0, placePts: 0, kills: 0, totalPts: 0 })
        const e = map.get(key)!
        const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
        e.placePts += pp
        e.kills += r.total_kills ?? 0
        e.totalPts += pp + Math.round((r.total_kills ?? 0) * rule.kill_pts)
        e.matches++
        if ((r.placement ?? 99) === 1) e.wwcd++
      }
    }
    return map
  }, [resultsByMatch, matchToRule])

  if (stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        No stage information available
      </div>
    )
  }

  const prizeByRank = new Map(prizeConfig.map(p => [p.rank, p]))

  function displayPrize(teamId: string | null, placementPrize: number | null): string {
    const bonus = teamId ? (wwcdBonusByTeamId[teamId]?.prize ?? 0) : 0
    const total = (placementPrize ?? 0) + bonus
    if (total === 0 && placementPrize == null) return '-'
    return formatPrize(total, currency)
  }

  function displayPts(teamId: string | null, base: number | null, field: 'pgs' | 'pgc'): string | number {
    const bonus = teamId ? (field === 'pgs' ? (wwcdBonusByTeamId[teamId]?.pgs ?? 0) : (wwcdBonusByTeamId[teamId]?.pgc ?? 0)) : 0
    if (bonus === 0) return base ?? '-'
    return (base ?? 0) + bonus
  }

  const btnBase = 'flex items-center justify-center font-medium border transition-colors rounded-lg text-xs'
  const btnActive = 'bg-yellow-400 border-yellow-400 text-gray-900'
  const btnIdle = 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'
  const tabBase = 'flex items-center rounded-lg font-medium border transition-colors'
  const tabActive = 'bg-yellow-400 border-yellow-400 text-gray-900'
  const tabIdle = 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'

  function selectDirectStage(stageId: string) {
    setSelectedSeriesId(null)
    setSelectedCombinedId(null)
    setSelectedStageId(stageId)
    setSelectedMatchId(null)
  }

  function selectSeriesStage(stageId: string) {
    setSelectedStageId(stageId)
    setSelectedMatchId(null)
  }

  function toggleSeries(seriesId: string) {
    if (selectedSeriesId === seriesId && !selectedStageId) {
      setSelectedSeriesId(null)
    } else {
      setSelectedSeriesId(seriesId)
      setSelectedCombinedId(null)
      setSelectedStageId(null)
      setSelectedMatchId(null)
    }
  }

  function toggleCombined(combinedId: string) {
    if (selectedCombinedId === combinedId) {
      setSelectedCombinedId(null)
    } else {
      setSelectedCombinedId(combinedId)
      setSelectedSeriesId(null)
      setSelectedStageId(null)
      setSelectedMatchId(null)
    }
  }

  const selectedSeriesName = series.find(s => s.id === selectedSeriesId)?.name ?? ''
  const selectedCombined = combined.find(c => c.id === selectedCombinedId) ?? null

  // Unified top-level tab ordering: each entity carries its own tab_order
  // and admin can drag a single combined list to reorder the public tabs.
  type TopTab =
    | { kind: 'series'; series: SeriesItem; orderKey: number }
    | { kind: 'stage'; stage: Stage & { matches: Match[] }; orderKey: number }
    | { kind: 'combined'; combined: CombinedItem; orderKey: number }
  const topTabs: TopTab[] = useMemo(() => {
    const tabs: TopTab[] = []
    for (const sr of series) {
      tabs.push({ kind: 'series', series: sr, orderKey: sr.tab_order })
    }
    for (const stage of stages) {
      if (stage.series_id) continue
      tabs.push({ kind: 'stage', stage, orderKey: stage.tab_order })
    }
    for (const cb of combined) {
      tabs.push({ kind: 'combined', combined: cb, orderKey: cb.tab_order })
    }
    return tabs.sort((a, b) => a.orderKey - b.orderKey)
  }, [series, stages, combined])

  const isNothingSelected = !selectedSeriesId && !selectedStageId && !selectedCombinedId

  return (
    <div>
      {/* Navigation — same scopeBtn style as Player Data / Team Data tabs.
          Series, standalone stages and combined scoreboards are interleaved
          by their effective order so admin can lay them out freely. */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          {topTabs.map(tab => {
            const baseCls = 'px-2.5 py-1 text-xs rounded-lg border transition-colors'
            const idleCls = 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'
            const activeCls = 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold'
            if (tab.kind === 'series') {
              const active = selectedSeriesId === tab.series.id && !selectedStageId
              return (
                <button key={`series-${tab.series.id}`} onClick={() => toggleSeries(tab.series.id)} className={`${baseCls} ${active ? activeCls : idleCls}`}>
                  {tab.series.name}
                </button>
              )
            }
            if (tab.kind === 'stage') {
              const active = selectedStageId === tab.stage.id && !selectedSeriesId && !selectedCombinedId
              return (
                <button key={`stage-${tab.stage.id}`} onClick={() => selectDirectStage(tab.stage.id)} className={`${baseCls} ${active ? activeCls : idleCls}`}>
                  {tab.stage.name}
                </button>
              )
            }
            const active = selectedCombinedId === tab.combined.id
            return (
              <button key={`combined-${tab.combined.id}`} onClick={() => toggleCombined(tab.combined.id)} className={`${baseCls} ${active ? activeCls : idleCls}`}>
                {tab.combined.name}
              </button>
            )
          })}
        </div>

        {selectedSeriesId && stagesBySeries.has(selectedSeriesId) && (
          <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-yellow-300">
            {(stagesBySeries.get(selectedSeriesId) ?? []).map(stage => {
              const active = selectedStageId === stage.id
              return (
                <button
                  key={stage.id}
                  onClick={() => selectSeriesStage(stage.id)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${active ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
                >
                  {stage.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Match buttons (only shown when a stage/series is selected) */}
      {selectedSeriesId && !selectedStageId && seriesLevelStages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
          {seriesLevelStages.map(stage => {
            const stageMatches = stage.matches.filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
            if (stageMatches.length === 0) return null
            return (
              <div key={stage.id} className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 font-medium">{stage.name}</span>
                {stageMatches.map((match, idx) => {
                  const isSel = selectedMatchId === match.id
                  return (
                    <button key={match.id} onClick={() => setSelectedMatchId(isSel ? null : match.id)}
                      className={`w-10 h-8 ${btnBase} ${isSel ? btnActive : btnIdle}`}>
                      M{idx + 1}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : stageLevelMatches.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
          {stageMatchGroups.map((group, gi) => (
            <div key={group.date || gi} className="flex items-center gap-1.5">
              {group.label && <span className="text-[11px] text-gray-400 font-medium mr-0.5">{group.label}</span>}
              {group.matches.map(match => {
                const idx = stageLevelMatches.findIndex(m => m.id === match.id)
                const isSel = selectedMatchId === match.id
                return (
                  <button key={match.id} onClick={() => setSelectedMatchId(isSel ? null : match.id)}
                    className={`w-10 h-8 ${btnBase} ${isSel ? btnActive : btnIdle}`}>
                    M{idx + 1}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}

      {isNothingSelected ? (
        /* Initial state: full-width Final Standings with match stats */
        <div className="flex flex-col gap-4">
          {rankBoard.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-800">Final Standings</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-3 py-2 w-8">#</th>
                      <th className="text-left px-3 py-2">Team</th>
                      <th className="text-right px-3 py-2">M</th>
                      <th className="text-right px-3 py-2">WWCD</th>
                      <th className="text-right px-3 py-2">Plc Pts</th>
                      <th className="text-right px-3 py-2">Kills</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500">Total</th>
                      {hasPrize && <th className="text-right px-3 py-2">Prize</th>}
                      {hasPgsPoints && <th className="text-right px-3 py-2">PGS</th>}
                      {hasPgcPoints && <th className="text-right px-3 py-2">PGC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Disqualified teams are pulled out of the active ranking, listed at the
                      // bottom of the table marked DQ, with all stat columns hidden.
                      const activeRows = rankBoard.filter(r => !r.teamId || !dqTeamIds.has(r.teamId))
                      const dqRows = rankBoard.filter(r => r.teamId && dqTeamIds.has(r.teamId))
                      // Re-rank actives so removed DQ slots don't leave gaps
                      const renumbered = activeRows.map((r, i) => ({ ...r, displayRank: i + 1 }))
                      const totalCols = 7 + (hasPrize ? 1 : 0) + (hasPgsPoints ? 1 : 0) + (hasPgcPoints ? 1 : 0)
                      return (
                        <>
                          {renumbered.map(row => {
                            const pc = prizeByRank.get(row.rank)
                            const logo = resolveLogoUrl(row.teamId, row.teamName, aliasLogoLookup)
                            const stats = row.teamId ? overallStandingsMap.get(row.teamId) : null
                            return (
                              <tr key={row.rank} className={`border-b border-gray-50 last:border-0 ${row.displayRank <= 3 ? 'bg-amber-50/30' : ''}`}>
                                <td className={`px-3 py-2 font-mono text-xs ${rankStyle(row.displayRank)}`}>{row.displayRank}</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    {logo ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                                    ) : (
                                      <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                                    )}
                                    <span className="font-medium text-gray-800 text-xs leading-snug">
                                      {row.teamId ? (
                                        <Link href={`/teams/${row.teamId}`} className="hover:text-yellow-600">{row.teamName}</Link>
                                      ) : row.teamName}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right text-gray-400 text-xs">{stats?.matches ?? '-'}</td>
                                <td className="px-3 py-2 text-right text-gray-400 text-xs">{stats?.wwcd ?? '-'}</td>
                                <td className="px-3 py-2 text-right text-gray-500 text-xs">{stats?.placePts ?? '-'}</td>
                                <td className="px-3 py-2 text-right text-gray-500 text-xs">{stats?.kills ?? '-'}</td>
                                <td className="px-3 py-2 text-right font-bold text-gray-900 text-xs">{stats?.totalPts ?? '-'}</td>
                                {hasPrize && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPrize(row.teamId, pc?.prize ?? null)}</td>}
                                {hasPgsPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPts(row.teamId, pc?.pgs_points ?? null, 'pgs')}</td>}
                                {hasPgcPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPts(row.teamId, pc?.pgc_points ?? null, 'pgc')}</td>}
                              </tr>
                            )
                          })}
                          {dqRows.length > 0 && (
                            <tr>
                              <td colSpan={totalCols} className="border-t-2 border-red-300 px-3 py-1.5 bg-red-50/40 text-[10px] font-bold text-red-500 tracking-wide">
                                ✕ DISQUALIFIED
                              </td>
                            </tr>
                          )}
                          {dqRows.map(row => {
                            const logo = resolveLogoUrl(row.teamId, row.teamName, aliasLogoLookup)
                            return (
                              <tr key={`dq-${row.teamId ?? row.teamName}`} className="border-b border-gray-50 last:border-0 bg-red-50/20">
                                <td className="px-3 py-2 font-mono text-xs font-bold text-red-500">DQ</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    {logo ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100 opacity-60" />
                                    ) : (
                                      <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                                    )}
                                    <span className="font-medium text-gray-500 text-xs leading-snug line-through">
                                      {row.teamId ? (
                                        <Link href={`/teams/${row.teamId}`} className="hover:text-yellow-600">{row.teamName}</Link>
                                      ) : row.teamName}
                                    </span>
                                  </div>
                                </td>
                                <td colSpan={totalCols - 2} className="px-3 py-2 text-right text-[10px] text-red-500 italic">disqualified</td>
                              </tr>
                            )
                          })}
                        </>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {specialAwards.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-800">Special Awards</h2>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {specialAwards.map((award) => (
                    <tr key={award.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-semibold text-yellow-700">{award.awardName}</div>
                        {award.playerName && (
                          <div className="text-xs text-gray-600 mt-0.5">
                            {award.playerId ? (
                              <Link href={`/players/${award.playerId}`} className="hover:text-yellow-600">{award.playerName}</Link>
                            ) : award.playerName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {award.prize != null && <div className="text-xs font-medium text-gray-800">{formatPrize(award.prize, currency)}</div>}
                        {award.pgsPoints != null && <div className="text-xs text-gray-500">{award.pgsPoints} PGS</div>}
                        {award.pgcPoints != null && <div className="text-xs text-gray-500">{award.pgcPoints} PGC</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Stage/Series/Combined selected: full-width scoreboard, no Final Standings */
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {selectedCombinedId ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="font-semibold text-sm text-gray-800">{selectedCombined?.name ?? ''} — Standings</span>
                </div>
                {(combinedStandings[selectedCombinedId] ?? []).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                          <th className="text-left px-4 py-2 w-8">#</th>
                          <th className="text-left px-4 py-2">Team</th>
                          <th className="text-right px-4 py-2">M</th>
                          <th className="text-right px-4 py-2">WWCD</th>
                          <th className="text-right px-4 py-2">Plc Pts</th>
                          <th className="text-right px-4 py-2">Kills</th>
                          <th className="text-right px-4 py-2 font-semibold text-gray-500">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const standings = combinedStandings[selectedCombinedId] ?? []
                          const advCount = selectedCombined?.advance_count ?? 0
                          const elimCount = selectedCombined?.eliminate_count ?? 0
                          return standings.map((s, i) => {
                            const logo = resolveLogoUrl(s.teamId, s.teamName, aliasLogoLookup)
                            const showAdvLine = advCount > 0 && i === advCount
                            const showElimLine = elimCount > 0 && i === standings.length - elimCount
                            return (
                              <Fragment key={`${s.teamId ?? s.teamName}-${i}`}>
                                {showAdvLine && (
                                  <tr>
                                    <td colSpan={7} className="p-0">
                                      <div className="flex flex-col items-start">
                                        <span className="text-[10px] font-bold text-green-600 px-3 py-0.5 tracking-wide">▲ ADVANCE</span>
                                        <div className="border-b-2 border-green-400 w-full mb-1" />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                {showElimLine && (
                                  <tr>
                                    <td colSpan={7} className="p-0">
                                      <div className="border-t-2 border-red-400 flex items-center mt-1">
                                        <span className="text-[10px] font-bold text-red-500 px-3 py-0.5 tracking-wide">▼ ELIMINATED</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                <tr className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                                  <td className={`px-4 py-2 font-mono text-xs ${rankStyle(i + 1)}`}>{i + 1}</td>
                                  <td className="px-4 py-2 text-xs">
                                    <div className="flex items-center gap-1.5">
                                      {logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                                      ) : (
                                        <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                                      )}
                                      {s.teamId ? (
                                        <Link href={`/teams/${s.teamId}`} className="font-medium text-gray-800 hover:text-yellow-600">{s.teamName}</Link>
                                      ) : <span className="font-medium text-gray-800">{s.teamName}</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.matches}</td>
                                  <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.wwcd}</td>
                                  <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.placePts}</td>
                                  <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.killPts}</td>
                                  <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{s.totalPts}</td>
                                </tr>
                              </Fragment>
                            )
                          })
                        })()}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-10 text-center text-gray-400 text-sm">No imported matches in the selected stages yet</div>
                )}
              </div>
            ) : selectedSeriesId && !selectedStageId ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="font-semibold text-sm text-gray-800">{selectedSeriesName} — Standings</span>
                </div>
                {!selectedMatchId ? (
                  seriesStandings.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="text-left px-4 py-2 w-8">#</th>
                            <th className="text-left px-4 py-2">Team</th>
                            <th className="text-right px-4 py-2">M</th>
                            <th className="text-right px-4 py-2">WWCD</th>
                            <th className="text-right px-4 py-2">Plc Pts</th>
                            <th className="text-right px-4 py-2">Kills</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const selSeries = series.find(sr => sr.id === selectedSeriesId)
                            const advCount = selSeries?.advance_count ?? 0
                            const elimCount = selSeries?.eliminate_count ?? 0
                            return seriesStandings.map((s, i) => {
                              const logo = resolveLogoUrl(s.teamId, s.teamName, aliasLogoLookup)
                              const showAdvLine = advCount > 0 && i === advCount
                              const showElimLine = elimCount > 0 && i === seriesStandings.length - elimCount
                              return (
                                <Fragment key={`${s.teamId ?? s.teamName}-${i}`}>
                                  {showAdvLine && (
                                    <tr>
                                      <td colSpan={7} className="p-0">
                                        <div className="flex flex-col items-start">
                                          <span className="text-[10px] font-bold text-green-600 px-3 py-0.5 tracking-wide">▲ ADVANCE</span>
                                          <div className="border-b-2 border-green-400 w-full mb-1" />
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  {showElimLine && (
                                    <tr>
                                      <td colSpan={7} className="p-0">
                                        <div className="border-t-2 border-red-400 flex items-center mt-1">
                                          <span className="text-[10px] font-bold text-red-500 px-3 py-0.5 tracking-wide">▼ ELIMINATED</span>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  <tr className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                                    <td className={`px-4 py-2 font-mono text-xs ${rankStyle(i + 1)}`}>{i + 1}</td>
                                    <td className="px-4 py-2 text-xs">
                                      <div className="flex items-center gap-1.5">
                                        {logo ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                                        ) : (
                                          <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                                        )}
                                        {s.teamId ? (
                                          <Link href={`/teams/${s.teamId}`} className="font-medium text-gray-800 hover:text-yellow-600">{s.teamName}</Link>
                                        ) : <span className="font-medium text-gray-800">{s.teamName}</span>}
                                      </div>
                                    </td>
                                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.matches}</td>
                                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.wwcd}</td>
                                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.placePts}</td>
                                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.totalPts - s.placePts}</td>
                                    <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{s.totalPts}</td>
                                  </tr>
                                </Fragment>
                              )
                            })
                          })()}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-10 text-center text-gray-400 text-sm">No imported matches yet</div>
                  )
                ) : (
                  seriesMatchResults.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="text-left px-4 py-2 w-8">#</th>
                            <th className="text-left px-4 py-2">Team</th>
                            <th className="text-right px-4 py-2">Plc</th>
                            <th className="text-right px-4 py-2">WWCD</th>
                            <th className="text-right px-4 py-2">Plc Pts</th>
                            <th className="text-right px-4 py-2">Kills</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seriesMatchResults.map((r: AnyObj, i: number) => {
                            const teamName = r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '-')
                            const logo = resolveLogoUrl(r.team_id, teamName, aliasLogoLookup)
                            return (
                              <tr key={r.id ?? i} className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                                <td className={`px-4 py-2 font-mono text-xs ${rankStyle(i + 1)}`}>{i + 1}</td>
                                <td className="px-4 py-2 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    {logo ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                                    ) : (
                                      <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                                    )}
                                    {r.team_id ? (
                                      <Link href={`/teams/${r.team_id}`} className="font-medium text-gray-800 hover:text-yellow-600">{teamName}</Link>
                                    ) : <span className="font-medium text-gray-800">{teamName}</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.placement}</td>
                                <td className="px-4 py-2 text-right text-gray-400 text-xs">{r.placement === 1 ? 1 : 0}</td>
                                <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.placementPts}</td>
                                <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.killPts}</td>
                                <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{r.matchPts}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            ) : selectedStage ? (
              <MatchStageView
                key={selectedStage.id}
                stage={selectedStage}
                matches={selectedStage.matches}
                selectedMatchId={selectedMatchId}
                resultsByMatch={resultsByMatch}
                damageByMatch={damageByMatch}
                aliasLogoLookup={aliasLogoLookup}
                additionalPts={stageAdditionalPts[selectedStage.id]}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
