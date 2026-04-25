'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import { calcPlacementPts } from '@/lib/scoring'
import type { Stage, Match } from '@/lib/types'

interface TeamResult {
  id: string
  match_id: string
  team_id: string | null
  pubg_team_name: string | null
  placement: number | null
  total_kills: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teams: any
}

interface PlayerDamage {
  placement: number
  damage_dealt: number
}

interface ComputedStanding {
  key: string
  teamId: string | null
  teamName: string
  matchesPlayed: number
  totalPts: number
  totalPlacementPts: number
  lastMatchPts: number
  lastMatchPlacement: number
  lastMatchDamage: number
}

interface Props {
  stage: Stage
  matches: Match[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultsByMatch: Record<string, any[]>
  damageByMatch: Record<string, PlayerDamage[]>
}

function computeStandings(
  matches: Match[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultsByMatch: Record<string, any[]>,
  damageByMatch: Record<string, PlayerDamage[]>
): ComputedStanding[] {
  const sorted = [...matches].filter((m) => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
  const statMap = new Map<string, ComputedStanding & { lastMatchOrder: number }>()

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
      const placementPts = calcPlacementPts(placement)
      const killPts = r.total_kills ?? 0
      const matchPts = placementPts + killPts
      const matchDamage = damageByPlacement.get(placement) ?? 0

      if (!statMap.has(key)) {
        statMap.set(key, {
          key,
          teamId: r.team_id,
          teamName: r.teams?.name ?? r.pubg_team_name ?? '?',
          matchesPlayed: 0,
          totalPts: 0,
          totalPlacementPts: 0,
          lastMatchOrder: -Infinity,
          lastMatchPts: 0,
          lastMatchPlacement: 99,
          lastMatchDamage: 0,
        })
      }

      const stat = statMap.get(key)!
      stat.matchesPlayed++
      stat.totalPts += matchPts
      stat.totalPlacementPts += placementPts

      if (match.order_num > stat.lastMatchOrder) {
        stat.lastMatchOrder = match.order_num
        stat.lastMatchPts = matchPts
        stat.lastMatchPlacement = placement
        stat.lastMatchDamage = matchDamage
      }
    }
  }

  return [...statMap.values()].sort((a, b) => {
    if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
    if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
    if (b.lastMatchPts !== a.lastMatchPts) return b.lastMatchPts - a.lastMatchPts
    if (a.lastMatchPlacement !== b.lastMatchPlacement) return a.lastMatchPlacement - b.lastMatchPlacement
    return b.lastMatchDamage - a.lastMatchDamage
  })
}

export default function MatchStageView({ stage, matches, resultsByMatch, damageByMatch }: Props) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  const importedMatches = [...matches]
    .filter((m) => m.status === 'imported')
    .sort((a, b) => a.order_num - b.order_num)

  const standings = computeStandings(matches, resultsByMatch, damageByMatch)

  const selectedMatch = matches.find((m) => m.id === selectedMatchId)
  const selectedResults = selectedMatchId ? (resultsByMatch[selectedMatchId] ?? []) : []

  const perMatchSorted = selectedResults
    .slice()
    .map((r) => ({
      ...r,
      placementPts: calcPlacementPts(r.placement ?? 99),
      killPts: r.total_kills ?? 0,
      matchPts: calcPlacementPts(r.placement ?? 99) + (r.total_kills ?? 0),
    }))
    .sort((a, b) => {
      if (b.matchPts !== a.matchPts) return b.matchPts - a.matchPts
      return (a.placement ?? 99) - (b.placement ?? 99)
    })

  const stageTypeLabel =
    stage.type === 'group' ? 'Group Stage' :
    stage.type === 'playoff' ? 'Playoff' : 'Grand Final'

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800">{stage.name}</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">{stageTypeLabel}</span>
        </div>
        <span className="text-xs text-gray-400">{importedMatches.length} matches</span>
      </div>

      {/* Cumulative standings */}
      {standings.length > 0 && (
        <div className="p-5 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Team Rankings</p>
          <p className="text-xs text-gray-400 mb-3">Placement Pts + Kill Pts = Total | 1–8: 10,6,5,4,3,2,1,1</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 w-8">#</th>
                  <th className="text-left pb-2">Team</th>
                  <th className="text-right pb-2">Matches</th>
                  <th className="text-right pb-2">Plc Pts</th>
                  <th className="text-right pb-2">Kill Pts</th>
                  <th className="text-right pb-2 font-bold text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.key} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="py-1.5 font-medium text-gray-800">
                      {s.teamId ? (
                        <Link href={`/teams/${s.teamId}`} className="hover:text-yellow-600">
                          {s.teamName}
                        </Link>
                      ) : (
                        <span>{s.teamName}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{s.matchesPlayed}</td>
                    <td className="py-1.5 text-right text-gray-500">{s.totalPlacementPts}</td>
                    <td className="py-1.5 text-right text-gray-500">{s.totalPts - s.totalPlacementPts}</td>
                    <td className="py-1.5 text-right font-bold text-gray-900">{s.totalPts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match tab buttons */}
      {importedMatches.length > 0 && (
        <div className="p-5">
          <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">Matches</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {importedMatches.map((match, i) => (
              <button
                key={match.id}
                onClick={() => setSelectedMatchId(selectedMatchId === match.id ? null : match.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  selectedMatchId === match.id
                    ? 'bg-yellow-400 border-yellow-400 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'
                }`}
              >
                M{i + 1}
                {match.map && (
                  <span className="text-xs ml-1 opacity-60">{getMapDisplayName(match.map)}</span>
                )}
              </button>
            ))}
          </div>

          {/* Per-match scoreboard */}
          {selectedMatch && perMatchSorted.length > 0 && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-600">
                  Match {importedMatches.findIndex((m) => m.id === selectedMatch.id) + 1} Scoreboard
                  {selectedMatch.map && ` — ${getMapDisplayName(selectedMatch.map)}`}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-4 py-2">Team</th>
                    <th className="text-right px-4 py-2">Plc</th>
                    <th className="text-right px-4 py-2">Plc Pts</th>
                    <th className="text-right px-4 py-2">Kill Pts</th>
                    <th className="text-right px-4 py-2 font-bold text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {perMatchSorted.map((r, i) => (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-gray-800">
                        {r.team_id ? (
                          <Link href={`/teams/${r.team_id}`} className="hover:text-yellow-600">
                            {r.teams?.name ?? r.pubg_team_name ?? '-'}
                          </Link>
                        ) : (
                          <span>{r.pubg_team_name ?? '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{r.placement}</td>
                      <td className="px-4 py-2 text-right text-gray-500">{r.placementPts}</td>
                      <td className="px-4 py-2 text-right text-gray-500">{r.killPts}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-900">{r.matchPts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
