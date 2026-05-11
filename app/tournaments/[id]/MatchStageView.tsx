'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { calcPlacementPtsWithRule, ruleFromStage, type ScoringRuleConfig } from '@/lib/scoring'
import { stripTagPrefix } from '@/lib/pubg-api'
import type { Stage, Match } from '@/lib/types'

interface PlayerDamage {
  placement: number
  damage_dealt: number
}

interface ComputedStanding {
  key: string
  teamId: string | null
  teamName: string
  matchesPlayed: number
  wwcd: number
  totalPts: number
  totalPlacementPts: number
  totalKillPts: number
  lastMatchPts: number
  lastMatchPlacement: number
  lastMatchKills: number
  lastMatchDamage: number
}

interface Props {
  stage: Stage
  matches: Match[]
  selectedMatchId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultsByMatch: Record<string, any[]>
  damageByMatch: Record<string, PlayerDamage[]>
  aliasLogoLookup: Record<string, string | null>
  additionalPts?: Record<string, number>
}

function resolveLogoUrl(
  teamId: string | null,
  name: string,
  lookup: Record<string, string | null>
): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

function computeStandings(
  matches: Match[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultsByMatch: Record<string, any[]>,
  damageByMatch: Record<string, PlayerDamage[]>,
  rule: ScoringRuleConfig,
  extraPts: Record<string, number> = {}
): ComputedStanding[] {
  const sorted = [...matches].filter((m) => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
  const statMap = new Map<string, ComputedStanding & { lastMatchOrder: number; firstChickenOrder: number }>()

  for (const match of sorted) {
    const results = resultsByMatch[match.id] ?? []
    const damageList = damageByMatch[match.id] ?? []

    const damageByPlacement = new Map<number, number>()
    for (const d of damageList) {
      damageByPlacement.set(d.placement, (damageByPlacement.get(d.placement) ?? 0) + d.damage_dealt)
    }

    for (const r of results) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      const placement = r.placement ?? 99
      const placementPts = calcPlacementPtsWithRule(placement, rule)
      const killPts = Math.round((r.total_kills ?? 0) * rule.kill_pts)
      const matchPts = placementPts + killPts
      const matchDamage = damageByPlacement.get(placement) ?? 0

      if (!statMap.has(key)) {
        statMap.set(key, {
          key,
          teamId: r.team_id,
          teamName: r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '?'),
          matchesPlayed: 0,
          wwcd: 0,
          totalPts: 0,
          totalPlacementPts: 0,
          totalKillPts: 0,
          lastMatchOrder: -Infinity,
          lastMatchPts: 0,
          lastMatchPlacement: 99,
          lastMatchKills: 0,
          lastMatchDamage: 0,
          firstChickenOrder: Infinity,
        })
      }

      const stat = statMap.get(key)!
      stat.matchesPlayed++
      if (placement === 1) {
        stat.wwcd++
        if (match.order_num < stat.firstChickenOrder) stat.firstChickenOrder = match.order_num
      }
      stat.totalPts += matchPts
      stat.totalPlacementPts += placementPts
      stat.totalKillPts += killPts

      if (match.order_num > stat.lastMatchOrder) {
        stat.lastMatchOrder = match.order_num
        stat.lastMatchPts = matchPts
        stat.lastMatchPlacement = placement
        stat.lastMatchKills = r.total_kills ?? 0
        stat.lastMatchDamage = matchDamage
      }
    }
  }

  for (const stat of statMap.values()) {
    stat.totalPts += (stat.teamId ? extraPts[stat.teamId] : undefined) ?? extraPts[stat.teamName.toLowerCase()] ?? 0
  }

  const results = [...statMap.values()]

  function sortBySubType(arr: typeof results, subType: string): typeof results {
    if (subType === 'chicken') {
      return arr.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (a.wwcd > 0 && b.wwcd > 0 && a.firstChickenOrder !== b.firstChickenOrder) return a.firstChickenOrder - b.firstChickenOrder
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
        if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
        return b.lastMatchDamage - a.lastMatchDamage
      })
    }
    if (subType === 'chicken_v2') {
      return arr.sort((a, b) => {
        if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
        if (b.totalKillPts !== a.totalKillPts) return b.totalKillPts - a.totalKillPts
        if (b.lastMatchKills !== a.lastMatchKills) return b.lastMatchKills - a.lastMatchKills
        return a.lastMatchPlacement - b.lastMatchPlacement
      })
    }
    return arr.sort((a, b) => {
      if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
      if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
      if (b.lastMatchPts !== a.lastMatchPts) return b.lastMatchPts - a.lastMatchPts
      if (a.lastMatchPlacement !== b.lastMatchPlacement) return a.lastMatchPlacement - b.lastMatchPlacement
      return b.lastMatchDamage - a.lastMatchDamage
    })
  }

  if (rule.type === 'smash') {
    const maxOrder = results.reduce((m, r) => Math.max(m, r.lastMatchOrder), -Infinity)
    const winnerIdx = results.findIndex(r => r.lastMatchOrder === maxOrder && r.lastMatchPlacement === 1)
    if (winnerIdx >= 0) {
      const winner = results[winnerIdx]
      const rest = results.filter((_, i) => i !== winnerIdx)
      return [winner, ...sortBySubType(rest, rule.smash_sub_type ?? 'super')]
    }
    return sortBySubType(results, rule.smash_sub_type ?? 'super')
  }

  return sortBySubType(results, rule.type ?? 'super')
}

const rankStyle = (i: number) =>
  i === 0 ? 'text-yellow-500 font-bold' :
  i === 1 ? 'text-gray-400 font-semibold' :
  i === 2 ? 'text-amber-600 font-semibold' : 'text-gray-300'

export default function MatchStageView({ stage, matches, selectedMatchId, resultsByMatch, damageByMatch, aliasLogoLookup, additionalPts = {} }: Props) {
  const rule = ruleFromStage(stage.scoring_rules)
  const standings = computeStandings(matches, resultsByMatch, damageByMatch, rule, additionalPts)

  const selectedMatch = selectedMatchId ? matches.find((m) => m.id === selectedMatchId) : null
  const selectedResults = selectedMatch ? (resultsByMatch[selectedMatch.id] ?? []) : []

  const perMatchSorted = selectedResults
    .slice()
    .map((r) => {
      const placementPts = calcPlacementPtsWithRule(r.placement ?? 99, rule)
      const killPts = Math.round((r.total_kills ?? 0) * rule.kill_pts)
      return { ...r, placementPts, killPts, matchPts: placementPts + killPts }
    })
    .sort((a, b) => {
      if (b.matchPts !== a.matchPts) return b.matchPts - a.matchPts
      return (a.placement ?? 99) - (b.placement ?? 99)
    })

  const stageTypeLabel =
    stage.type === 'group' ? 'Group' :
    stage.type === 'playoff' ? 'Playoff' : 'Final'

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-800">{stage.name}</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">{stageTypeLabel}</span>
        </div>
        {selectedMatch && (
          <span className="text-xs text-gray-400">
            Match {matches.filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num).findIndex(m => m.id === selectedMatch.id) + 1}
            {selectedMatch.map && ` · ${selectedMatch.map.replace('Baltic_Main', 'Erangel').replace('Savage_Main', 'Sanhok').replace('Desert_Main', 'Miramar').replace('DihorOtok_Main', 'Vikendi').replace('Tiger_Main', 'Taego').replace('Kiki_Main', 'Deston').replace('Neon_Main', 'Rondo')}`}
          </span>
        )}
      </div>

      {selectedMatchId === null ? (
        standings.length > 0 && (
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
                {standings.map((s, i) => {
                  const logo = resolveLogoUrl(s.teamId, s.teamName, aliasLogoLookup)
                  const advCount = stage.advance_count ?? 0
                  const elimCount = stage.eliminate_count ?? 0
                  const showAdvLine = advCount > 0 && i === advCount
                  const showElimLine = elimCount > 0 && i === standings.length - elimCount
                  return (
                  <Fragment key={s.key}>
                    {showAdvLine && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="flex flex-col items-start">
                            <span className="text-[10px] font-bold text-green-600 px-3 py-0.5 tracking-wide">
                              ▲ ADVANCE
                            </span>
                            <div className="border-b-2 border-green-400 w-full mb-1"></div>
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
                    <td className={`px-4 py-2 font-mono text-xs ${rankStyle(i)}`}>{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                      <div className="flex items-center gap-1.5">
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                        )}
                        {s.teamId ? (
                          <Link href={`/teams/${s.teamId}`} className="hover:text-yellow-600">{s.teamName}</Link>
                        ) : s.teamName}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.matchesPlayed}</td>
                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.wwcd}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.totalPlacementPts}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.totalKillPts}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{s.totalPts}</td>
                  </tr>
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        perMatchSorted.length > 0 && (
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
                {perMatchSorted.map((r, i) => {
                  const teamName = r._resolvedName ?? r.teams?.name ?? stripTagPrefix(r.display_name ?? r.pubg_team_name ?? '-')
                  const logo = resolveLogoUrl(r.team_id, teamName, aliasLogoLookup)
                  return (
                  <tr key={r.id} className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                    <td className={`px-4 py-2 font-mono text-xs ${rankStyle(i)}`}>{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                      <div className="flex items-center gap-1.5">
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt="" className="w-4 h-4 rounded object-contain shrink-0 border border-gray-100" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                        )}
                        {r.team_id ? (
                          <Link href={`/teams/${r.team_id}`} className="hover:text-yellow-600">{teamName}</Link>
                        ) : teamName}
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
  )
}
