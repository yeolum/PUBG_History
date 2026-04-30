'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import MatchStageView from './MatchStageView'
import { stripTagPrefix } from '@/lib/pubg-api'
import type { Stage, Match } from '@/lib/types'
import { calcPlacementPtsWithRule, ruleFromStage } from '@/lib/scoring'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

interface SeriesItem { id: string; name: string; order_num: number }
interface RankEntry { rank: number; teamId: string | null; teamName: string }
interface PrizeConfigItem { rank: number; prize: string | null; pgs_points: number | null; pgc_points: number | null }
interface SpecialAwardItem { id: string; awardName: string; playerId: string | null; playerName: string | null; prize: string | null; pgsPoints: number | null; pgcPoints: number | null }

interface Props {
  stages: (Stage & { matches: Match[] })[]
  series: SeriesItem[]
  resultsByMatch: Record<string, AnyObj[]>
  damageByMatch: Record<string, { placement: number; damage_dealt: number }[]>
  rankBoard: RankEntry[]
  prizeConfig: PrizeConfigItem[]
  hasPrize: boolean
  hasPgsPoints: boolean
  hasPgcPoints: boolean
  aliasLogoLookup: Record<string, string | null>
  stageAdditionalPts?: Record<string, Record<string, number>>
  wwcdBonusByTeamId?: Record<string, { prize: number; pgs: number; pgc: number; sym: string }>
  specialAwards?: SpecialAwardItem[]
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
  stages, series, resultsByMatch, damageByMatch, rankBoard, prizeConfig,
  hasPrize, hasPgsPoints, hasPgcPoints, aliasLogoLookup, stageAdditionalPts = {},
  wwcdBonusByTeamId = {}, specialAwards = [],
}: Props) {
  // All hooks must be before early return
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    () => stages[0]?.series_id ?? null
  )
  const [selectedStageId, setSelectedStageId] = useState<string | null>(
    () => stages[0]?.series_id ? null : (stages[0]?.id ?? null)
  )
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

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

  if (stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        No stage information available
      </div>
    )
  }

  const prizeByRank = new Map(prizeConfig.map(p => [p.rank, p]))

  function parsePrizeStr(s: string | null): { sym: string; val: number } | null {
    if (!s) return null
    const sym = s.match(/^[^\d]+/)?.[0] ?? '$'
    const val = parseInt(s.replace(/[^\d]/g, '') || '0', 10)
    return { sym, val }
  }

  function displayPrize(teamId: string | null, placementPrize: string | null): string {
    const bonus = teamId ? (wwcdBonusByTeamId[teamId]?.prize ?? 0) : 0
    if (bonus === 0) return placementPrize ?? '-'
    const p = parsePrizeStr(placementPrize)
    const sym = p?.sym ?? wwcdBonusByTeamId[teamId!]?.sym ?? '$'
    return `${sym}${((p?.val ?? 0) + bonus).toLocaleString('en-US')}`
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
      setSelectedStageId(null)
      setSelectedMatchId(null)
    }
  }

  const selectedSeriesName = series.find(s => s.id === selectedSeriesId)?.name ?? ''

  return (
    <div>
      {/* Navigation */}
      <div className="mb-3">
        {/* Top row: series + direct stage buttons */}
        <div className="flex flex-wrap gap-2 mb-1.5">
          {series.map(s => (
            <button
              key={s.id}
              onClick={() => toggleSeries(s.id)}
              className={`${tabBase} px-4 py-2 text-sm ${selectedSeriesId === s.id ? tabActive : tabIdle}`}
            >
              {s.name}
            </button>
          ))}
          {directStages.map(stage => (
            <button
              key={stage.id}
              onClick={() => selectDirectStage(stage.id)}
              className={`${tabBase} px-4 py-2 text-sm ${selectedStageId === stage.id && !selectedSeriesId ? tabActive : tabIdle}`}
            >
              {stage.name}
            </button>
          ))}
        </div>

        {/* Sub-row: stages within expanded series (smaller buttons, item 3) */}
        {selectedSeriesId && stagesBySeries.has(selectedSeriesId) && (
          <div className="flex flex-wrap gap-1.5 pl-4 border-l-2 border-yellow-400">
            {(stagesBySeries.get(selectedSeriesId) ?? []).map(stage => (
              <button
                key={stage.id}
                onClick={() => selectSeriesStage(stage.id)}
                className={`${tabBase} px-3 py-1 text-xs ${selectedStageId === stage.id ? tabActive : tabIdle}`}
              >
                {stage.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Match buttons */}
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

      {/* Two-column layout — always side-by-side with horizontal scroll on narrow screens */}
      <div className="overflow-x-auto">
      <div className="flex flex-row gap-4 items-start min-w-max">
        {/* Left: Final Standings + Special Awards */}
        {(rankBoard.length > 0 || specialAwards.length > 0) && (
          <div className="w-[21rem] shrink-0 flex flex-col gap-4">
            {rankBoard.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-800">Final Standings</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-3 py-2 w-8">#</th>
                      <th className="text-left px-3 py-2">Team</th>
                      {hasPrize && <th className="text-right px-3 py-2">Prize</th>}
                      {hasPgsPoints && <th className="text-right px-3 py-2">PGS</th>}
                      {hasPgcPoints && <th className="text-right px-3 py-2">PGC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rankBoard.map(row => {
                      const pc = prizeByRank.get(row.rank)
                      const logo = resolveLogoUrl(row.teamId, row.teamName, aliasLogoLookup)
                      return (
                        <tr key={row.rank} className={`border-b border-gray-50 last:border-0 ${row.rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                          <td className={`px-3 py-2 font-mono text-xs ${rankStyle(row.rank)}`}>{row.rank}</td>
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
                          {hasPrize && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPrize(row.teamId, pc?.prize ?? null)}</td>}
                          {hasPgsPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPts(row.teamId, pc?.pgs_points ?? null, 'pgs')}</td>}
                          {hasPgcPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{displayPts(row.teamId, pc?.pgc_points ?? null, 'pgc')}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
                          {award.prize && <div className="text-xs font-medium text-gray-800">{award.prize}</div>}
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
        )}

        {/* Right: Content */}
        <div className="flex-1 min-w-0">
          {selectedSeriesId && !selectedStageId ? (
            /* Series combined view (item 5) */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <span className="font-semibold text-sm text-gray-800">{selectedSeriesName} — 합산</span>
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
                        {seriesStandings.map((s, i) => {
                          const logo = resolveLogoUrl(s.teamId, s.teamName, aliasLogoLookup)
                          return (
                            <tr key={`${s.teamId ?? s.teamName}-${i}`} className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
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
                          )
                        })}
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
      </div>
    </div>
  )
}
