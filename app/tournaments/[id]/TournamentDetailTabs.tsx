'use client'

import { useState } from 'react'
import TournamentStagesView from './TournamentStagesView'
import PlayerStatsTable, { type PlayerStatRow, type PlayerMatchStat } from './PlayerStatsTable'
import TeamStatsTable, { type TeamStatRow, type DropLocationRow } from './TeamStatsTable'
import type { Stage, Match } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>
interface SeriesItem { id: string; name: string; order_num: number; advance_count: number | null; eliminate_count: number | null }
interface RankEntry { rank: number; teamId: string | null; teamName: string }
interface PrizeConfigItem { rank: number; prize: number | null; pgs_points: number | null; pgc_points: number | null }
interface SpecialAwardItem { id: string; awardName: string; playerId: string | null; playerName: string | null; prize: number | null; pgsPoints: number | null; pgcPoints: number | null }

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
  currency: string
  aliasLogoLookup: Record<string, string | null>
  stageAdditionalPts: Record<string, Record<string, number>>
  wwcdBonusByTeamId: Record<string, { prize: number; pgs: number; pgc: number }>
  specialAwards: SpecialAwardItem[]
  playerStats: PlayerStatRow[]
  playerStatsByMatch: Record<string, PlayerMatchStat[]>
  teamStats: TeamStatRow[]
  dropLocations: DropLocationRow[]
  mapKeys: string[]
}

type Tab = 'scoreboard' | 'players' | 'teams'

export default function TournamentDetailTabs(props: Props) {
  const [tab, setTab] = useState<Tab>('scoreboard')

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex border-b border-gray-200 mb-4 bg-white rounded-t-xl overflow-hidden">
        {tabBtn('scoreboard', 'Scoreboard')}
        {tabBtn('players', 'Player Data')}
        {tabBtn('teams', 'Team Data')}
      </div>

      {tab === 'scoreboard' && (
        <TournamentStagesView
          stages={props.stages}
          series={props.series}
          resultsByMatch={props.resultsByMatch}
          damageByMatch={props.damageByMatch}
          rankBoard={props.rankBoard}
          prizeConfig={props.prizeConfig}
          hasPrize={props.hasPrize}
          hasPgsPoints={props.hasPgsPoints}
          hasPgcPoints={props.hasPgcPoints}
          currency={props.currency}
          aliasLogoLookup={props.aliasLogoLookup}
          stageAdditionalPts={props.stageAdditionalPts}
          wwcdBonusByTeamId={props.wwcdBonusByTeamId}
          specialAwards={props.specialAwards}
        />
      )}

      {tab === 'players' && (
        <PlayerStatsTable
          playerStats={props.playerStats}
          stages={props.stages}
          series={props.series}
          playerStatsByMatch={props.playerStatsByMatch}
        />
      )}

      {tab === 'teams' && (
        <TeamStatsTable
          teamStats={props.teamStats}
          dropLocations={props.dropLocations}
          mapKeys={props.mapKeys}
          stages={props.stages}
          series={props.series}
          resultsByMatch={props.resultsByMatch}
        />
      )}
    </div>
  )
}
