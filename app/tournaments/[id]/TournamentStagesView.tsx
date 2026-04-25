'use client'

import { useState } from 'react'
import MatchStageView from './MatchStageView'
import type { Stage, Match } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

interface Props {
  stages: (Stage & { matches: Match[] })[]
  resultsByMatch: Record<string, AnyObj[]>
  damageByMatch: Record<string, { placement: number; damage_dealt: number }[]>
}

const STAGE_LABEL: Record<string, string> = {
  group: 'Group',
  playoff: 'Playoff',
  grand_final: 'Final',
}

export default function TournamentStagesView({ stages, resultsByMatch, damageByMatch }: Props) {
  const [selectedStageId, setSelectedStageId] = useState<string>(stages[0]?.id ?? '')

  if (stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        No stage information available
      </div>
    )
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0]

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5">
        {stages.map((stage) => {
          const isSelected = stage.id === selectedStage.id
          return (
            <button
              key={stage.id}
              onClick={() => setSelectedStageId(stage.id)}
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

      {/* key resets MatchStageView internal state when switching stages */}
      <MatchStageView
        key={selectedStage.id}
        stage={selectedStage}
        matches={selectedStage.matches}
        resultsByMatch={resultsByMatch}
        damageByMatch={damageByMatch}
      />
    </div>
  )
}
