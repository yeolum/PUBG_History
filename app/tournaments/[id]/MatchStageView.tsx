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
  display_name: string | null
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
          teamName: r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '?',
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

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function MatchStageView({ stage, matches, resultsByMatch, damageByMatch }: Props) {
  const [viewMode, setViewMode] = useState<'total' | string>('total')

  const importedMatches = [...matches]
    .filter((m) => m.status === 'imported')
    .sort((a, b) => a.order_num - b.order_num)

  const standings = computeStandings(matches, resultsByMatch, damageByMatch)

  const selectedMatch = viewMode !== 'total' ? matches.find((m) => m.id === viewMode) : null
  const selectedResults = selectedMatch ? (resultsByMatch[selectedMatch.id] ?? []) : []

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

  // Group matches by date
  const matchGroups: { date: string; matches: Match[] }[] = []
  for (const match of importedMatches) {
    const date = match.match_date ? match.match_date.split('T')[0] : ''
    const existing = matchGroups.find((g) => g.date === date)
    if (existing) existing.matches.push(match)
    else matchGroups.push({ date, matches: [match] })
  }

  const btnBase = 'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors'
  const btnActive = 'bg-yellow-400 border-yellow-400 text-gray-900'
  const btnIdle = 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'

  const rankColor = (i: number) =>
    i === 0 ? 'text-yellow-500 font-bold' :
    i === 1 ? 'text-gray-400 font-semibold' :
    i === 2 ? 'text-amber-600 font-semibold' :
    'text-gray-300'

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-800">{stage.name}</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
            {stage.type === 'group' ? 'Group' : stage.type === 'playoff' ? 'Playoff' : 'Final'}
          </span>
        </div>
        <span className="text-xs text-gray-400">{importedMatches.length} matches</span>
      </div>

      {importedMatches.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex flex-wrap gap-1.5 items-center">
          <button
            onClick={() => setViewMode('total')}
            className={`${btnBase} ${viewMode === 'total' ? btnActive : btnIdle} font-semibold`}
          >
            Total
          </button>

          {matchGroups.map((group) => (
            <div key={group.date} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-300 select-none">|</span>
              {group.date && (
                <span className="text-[10px] text-gray-400 mr-0.5">{formatDate(group.date)}</span>
              )}
              {group.matches.map((match) => {
                const idx = importedMatches.findIndex((m) => m.id === match.id)
                return (
                  <button
                    key={match.id}
                    onClick={() => setViewMode(match.id)}
                    className={`${btnBase} ${viewMode === match.id ? btnActive : btnIdle}`}
                  >
                    M{idx + 1}
                    {match.map && (
                      <span className="ml-1 opacity-50">{getMapDisplayName(match.map)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {viewMode === 'total' ? (
        standings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-4 py-2 w-8">#</th>
                  <th className="text-left px-4 py-2">Team</th>
                  <th className="text-right px-4 py-2">M</th>
                  <th className="text-right px-4 py-2">Plc Pts</th>
                  <th className="text-right px-4 py-2">Kills</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.key} className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                    <td className={`px-4 py-2 font-mono text-xs ${rankColor(i)}`}>{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                      {s.teamId ? (
                        <Link href={`/teams/${s.teamId}`} className="hover:text-yellow-600">{s.teamName}</Link>
                      ) : (
                        <span>{s.teamName}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{s.matchesPlayed}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.totalPlacementPts}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.totalPts - s.totalPlacementPts}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{s.totalPts}</td>
                  </tr>
                ))}
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
                  <th className="text-right px-4 py-2">Plc Pts</th>
                  <th className="text-right px-4 py-2">Kills</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {perMatchSorted.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/20' : ''}`}>
                    <td className={`px-4 py-2 font-mono text-xs ${rankColor(i)}`}>{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                      {r.team_id ? (
                        <Link href={`/teams/${r.team_id}`} className="hover:text-yellow-600">
                          {r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '-'}
                        </Link>
                      ) : (
                        <span>{r.pubg_team_name ?? '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.placement}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.placementPts}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{r.killPts}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs">{r.matchPts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
