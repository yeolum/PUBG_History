'use client'

import { useState } from 'react'
import Link from 'next/link'
import MatchStageView from './MatchStageView'
import type { Stage, Match } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

interface RankEntry {
  rank: number
  teamId: string | null
  teamName: string
}

interface PrizeConfigItem {
  rank: number
  prize: string | null
  pgs_points: number | null
  pgc_points: number | null
}

interface Props {
  stages: (Stage & { matches: Match[] })[]
  resultsByMatch: Record<string, AnyObj[]>
  damageByMatch: Record<string, { placement: number; damage_dealt: number }[]>
  rankBoard: RankEntry[]
  prizeConfig: PrizeConfigItem[]
  hasPrize: boolean
  hasPgsPoints: boolean
  hasPgcPoints: boolean
  aliasLogoLookup: Record<string, string | null>
}

const STAGE_LABEL: Record<string, string> = {
  group: 'Group',
  playoff: 'Playoff',
  grand_final: 'Final',
}

const rankStyle = (rank: number) =>
  rank === 1 ? 'text-yellow-500 font-bold' :
  rank === 2 ? 'text-gray-400 font-semibold' :
  rank === 3 ? 'text-amber-600 font-semibold' : 'text-gray-300'

function resolveLogoUrl(
  teamId: string | null,
  name: string,
  lookup: Record<string, string | null>
): string | null {
  if (!teamId) return null
  return lookup[`${teamId}:${name}`] ?? lookup[`${teamId}:`] ?? null
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function TournamentStagesView({
  stages,
  resultsByMatch,
  damageByMatch,
  rankBoard,
  prizeConfig,
  hasPrize,
  hasPgsPoints,
  hasPgcPoints,
  aliasLogoLookup,
}: Props) {
  const [selectedStageId, setSelectedStageId] = useState<string>(stages[0]?.id ?? '')
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  if (stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        No stage information available
      </div>
    )
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0]

  const importedMatches = [...(selectedStage?.matches ?? [])]
    .filter((m) => m.status === 'imported')
    .sort((a, b) => a.order_num - b.order_num)

  const matchGroups: { date: string; label: string; matches: Match[] }[] = []
  for (const match of importedMatches) {
    const date = match.match_date ? match.match_date.split('T')[0] : ''
    const existing = matchGroups.find((g) => g.date === date)
    if (existing) {
      existing.matches.push(match)
    } else {
      matchGroups.push({ date, label: date ? formatDateLabel(date) : '', matches: [match] })
    }
  }

  const prizeByRank = new Map(prizeConfig.map((p) => [p.rank, p]))

  const btnBase = 'flex items-center justify-center font-medium border transition-colors rounded-lg text-xs'
  const btnActive = 'bg-yellow-400 border-yellow-400 text-gray-900'
  const btnIdle = 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'

  return (
    <div>
      {/* Stage tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {stages.map((stage) => {
          const isSelected = stage.id === selectedStageId
          return (
            <button
              key={stage.id}
              onClick={() => { setSelectedStageId(stage.id); setSelectedMatchId(null) }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isSelected
                  ? 'bg-yellow-400 border-yellow-400 text-gray-900'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'
              }`}
            >
              {stage.name}
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                isSelected ? 'bg-yellow-300 text-gray-800' : 'bg-gray-100 text-gray-400'
              }`}>
                {STAGE_LABEL[stage.type] ?? stage.type}
              </span>
            </button>
          )
        })}
      </div>

      {/* Match buttons — full width, above cards */}
      {importedMatches.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
          {matchGroups.map((group, gi) => (
            <div key={group.date || gi} className="flex items-center gap-1.5">
              {group.label && (
                <span className="text-[11px] text-gray-400 font-medium mr-0.5">{group.label}</span>
              )}
              {group.matches.map((match) => {
                const idx = importedMatches.findIndex((m) => m.id === match.id)
                const isSelected = selectedMatchId === match.id
                return (
                  <button
                    key={match.id}
                    onClick={() => setSelectedMatchId(isSelected ? null : match.id)}
                    className={`w-10 h-8 ${btnBase} ${isSelected ? btnActive : btnIdle}`}
                  >
                    M{idx + 1}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Two-column layout: Final Standings | Stage view */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Final Standings */}
        {rankBoard.length > 0 && (
          <div className="lg:w-[21rem] w-full shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                {rankBoard.map((row) => {
                  const pc = prizeByRank.get(row.rank)
                  const logo = resolveLogoUrl(row.teamId, row.teamName, aliasLogoLookup)
                  return (
                    <tr key={row.rank} className={`border-b border-gray-50 last:border-0 ${row.rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                      <td className={`px-3 py-2 font-mono text-xs ${rankStyle(row.rank)}`}>{row.rank}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logo} alt="" className="w-4 h-4 rounded-full object-cover shrink-0 border border-gray-100" />
                          ) : (
                            <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                          )}
                          <span className="font-medium text-gray-800 text-xs leading-snug">
                            {row.teamId ? (
                              <Link href={`/teams/${row.teamId}`} className="hover:text-yellow-600">
                                {row.teamName}
                              </Link>
                            ) : row.teamName}
                          </span>
                        </div>
                      </td>
                      {hasPrize && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.prize ?? '-'}</td>}
                      {hasPgsPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.pgs_points ?? '-'}</td>}
                      {hasPgcPoints && <td className="px-3 py-2 text-right text-xs text-gray-600">{pc?.pgc_points ?? '-'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Right: Stage content */}
        <div className="flex-1 min-w-0">
          <MatchStageView
            key={selectedStage.id}
            stage={selectedStage}
            matches={selectedStage.matches}
            selectedMatchId={selectedMatchId}
            resultsByMatch={resultsByMatch}
            damageByMatch={damageByMatch}
            aliasLogoLookup={aliasLogoLookup}
          />
        </div>
      </div>
    </div>
  )
}
