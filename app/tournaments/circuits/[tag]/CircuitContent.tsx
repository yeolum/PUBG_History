'use client'

import { useState, useMemo, Fragment } from 'react'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type {
  CircuitChampion,
  CircuitTeamStat,
  CircuitPlayerStat,
  CircuitPlayerChampion,
  CircuitTournamentChampionPlayers,
  KillClub100Entry,
} from './page'
import { formatPrize } from '@/lib/currency'

type Tab = 'tournaments' | 'champions' | 'teams' | 'players'
type WinnersSubTab = 'team' | 'player'
type PlayerSubTab = 'total' | 'killclub'

type TeamSortKey = 'teamName' | 'tournaments' | 'matches' | 'wins' | 'kills' | 'kpg' | 'damage' | 'adr'
type PlayerSortKey = 'nickname' | 'teamName' | 'tournaments' | 'matches' | 'kills' | 'kpg' | 'assists' | 'knocks' | 'damage' | 'adr'

const STATUS_LABEL: Record<string, string> = { upcoming: '예정', ongoing: '진행중', completed: '종료' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

function TeamLogo({ url, name, size = 'sm' }: { url: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  if (!url) return null
  const cls = size === 'lg' ? 'w-12 h-12' : size === 'md' ? 'w-8 h-8' : 'w-5 h-5'
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} className={`${cls} rounded object-contain shrink-0`} />
}

function SortTh({ label, sortKey, currentKey, dir, onSort }: {
  label: string
  sortKey: string
  currentKey: string
  dir: 'asc' | 'desc'
  onSort: (k: string) => void
}) {
  const active = sortKey === currentKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer select-none whitespace-nowrap hover:text-gray-700"
    >
      {label}
      {active && <span className="ml-0.5 text-yellow-500">{dir === 'desc' ? ' ↓' : ' ↑'}</span>}
    </th>
  )
}

const PODIUM_STYLE = [
  { order: 0, height: 'h-16', bg: 'bg-gray-200', textColor: 'text-gray-500', medal: '🥈', label: '2nd' },
  { order: 1, height: 'h-24', bg: 'bg-yellow-400', textColor: 'text-gray-900', medal: '🥇', label: '1st' },
  { order: 2, height: 'h-10', bg: 'bg-amber-200', textColor: 'text-amber-700', medal: '🥉', label: '3rd' },
]

export default function CircuitContent({
  tag,
  tournaments,
  champions,
  playerChampions,
  tournamentChampionPlayers,
  teamStats,
  playerStats,
  killClub100,
}: {
  tag: string
  tournaments: Tournament[]
  champions: CircuitChampion[]
  playerChampions: CircuitPlayerChampion[]
  tournamentChampionPlayers: CircuitTournamentChampionPlayers[]
  teamStats: CircuitTeamStat[]
  playerStats: CircuitPlayerStat[]
  killClub100: KillClub100Entry[]
}) {
  const [tab, setTab] = useState<Tab>('champions')
  const [winnersSubTab, setWinnersSubTab] = useState<WinnersSubTab>('team')
  const [playerSubTab, setPlayerSubTab] = useState<PlayerSubTab>('total')
  const [teamSortKey, setTeamSortKey] = useState<TeamSortKey>('kills')
  const [teamSortDir, setTeamSortDir] = useState<'asc' | 'desc'>('desc')
  const [playerSortKey, setPlayerSortKey] = useState<PlayerSortKey>('kills')
  const [playerSortDir, setPlayerSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set())
  const [expandedKillClub, setExpandedKillClub] = useState<Set<string>>(new Set())
  const [expandedKillClubGroups, setExpandedKillClubGroups] = useState<Set<string>>(new Set())
  const [expandedChampTournaments, setExpandedChampTournaments] = useState<Set<string>>(new Set())

  function toggleTeam(key: string) {
    setExpandedTeams((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }
  function togglePlayer(key: string) {
    setExpandedPlayers((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }
  function toggleKillClub(key: string) {
    setExpandedKillClub((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }
  function toggleKillClubGroup(key: string) {
    setExpandedKillClubGroups((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }
  function toggleChampTournament(key: string) {
    setExpandedChampTournaments((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const championMap = useMemo(() => {
    const m = new Map<string, CircuitChampion>()
    for (const c of champions) m.set(c.tournamentId, c)
    return m
  }, [champions])

  const champPlayerMap = useMemo(() => {
    const m = new Map<string, CircuitTournamentChampionPlayers>()
    for (const e of tournamentChampionPlayers) m.set(e.tournamentId, e)
    return m
  }, [tournamentChampionPlayers])

  // 팀별 우승 횟수 집계 (podium용)
  const teamWinRanking = useMemo(() => {
    type WinEntry = { teamId: string | null; teamName: string; logoUrl: string | null; count: number }
    const map = new Map<string, WinEntry>()
    for (const c of champions) {
      if (!c.teamId && !c.teamName) continue
      const key = c.teamId ?? c.teamName
      const ex = map.get(key) ?? { teamId: c.teamId, teamName: c.teamName, logoUrl: c.logoUrl, count: 0 }
      ex.count++
      map.set(key, ex)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [champions])

  // playerChampions already sorted by wins desc from server
  const playerWinRanking = playerChampions

  function tabBtn(t: Tab, label: string) {
    return (
      <button
        onClick={() => setTab(t)}
        className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
      >
        {label}
      </button>
    )
  }

  function winnersSubBtn(t: WinnersSubTab, label: string) {
    return (
      <button
        onClick={() => setWinnersSubTab(t)}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${winnersSubTab === t ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
      >
        {label}
      </button>
    )
  }

  function toggleTeamSort(key: string) {
    const k = key as TeamSortKey
    if (teamSortKey === k) setTeamSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setTeamSortKey(k); setTeamSortDir('desc') }
  }

  function togglePlayerSort(key: string) {
    const k = key as PlayerSortKey
    if (playerSortKey === k) setPlayerSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setPlayerSortKey(k); setPlayerSortDir('desc') }
  }

  const sortedTeams = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q ? teamStats.filter((t) => t.teamName.toLowerCase().includes(q)) : teamStats
    return [...filtered].sort((a, b) => {
      let diff = 0
      if (teamSortKey === 'teamName') diff = a.teamName.localeCompare(b.teamName)
      else if (teamSortKey === 'tournaments') diff = a.tournaments - b.tournaments
      else if (teamSortKey === 'matches') diff = a.matches - b.matches
      else if (teamSortKey === 'wins') diff = a.wins - b.wins
      else if (teamSortKey === 'kills') diff = a.kills - b.kills
      else if (teamSortKey === 'kpg') diff = (a.matches > 0 ? a.kills / a.matches : 0) - (b.matches > 0 ? b.kills / b.matches : 0)
      else if (teamSortKey === 'damage') diff = a.damage - b.damage
      else if (teamSortKey === 'adr') diff = (a.matches > 0 ? a.damage / a.matches : 0) - (b.matches > 0 ? b.damage / b.matches : 0)
      return teamSortDir === 'desc' ? -diff : diff
    })
  }, [teamStats, teamSortKey, teamSortDir, search])

  const sortedPlayers = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q ? playerStats.filter((p) => p.nickname.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q)) : playerStats
    return [...filtered].sort((a, b) => {
      let diff = 0
      if (playerSortKey === 'nickname') diff = a.nickname.localeCompare(b.nickname)
      else if (playerSortKey === 'teamName') diff = a.teamName.localeCompare(b.teamName)
      else if (playerSortKey === 'tournaments') diff = a.tournaments - b.tournaments
      else if (playerSortKey === 'matches') diff = a.matches - b.matches
      else if (playerSortKey === 'kills') diff = a.kills - b.kills
      else if (playerSortKey === 'kpg') diff = (a.matches > 0 ? a.kills / a.matches : 0) - (b.matches > 0 ? b.kills / b.matches : 0)
      else if (playerSortKey === 'assists') diff = a.assists - b.assists
      else if (playerSortKey === 'knocks') diff = a.knocks - b.knocks
      else if (playerSortKey === 'damage') diff = a.damage - b.damage
      else if (playerSortKey === 'adr') diff = (a.matches > 0 ? a.damage / a.matches : 0) - (b.matches > 0 ? b.damage / b.matches : 0)
      return playerSortDir === 'desc' ? -diff : diff
    })
  }, [playerStats, playerSortKey, playerSortDir, search])

  const tournamentStartDateById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tournaments) if (t.start_date) m.set(t.id, t.start_date)
    return m
  }, [tournaments])

  const killClubRecent = useMemo(() => {
    return [...killClub100].sort((a, b) => {
      const da = tournamentStartDateById.get(a.tournamentId) ?? ''
      const db = tournamentStartDateById.get(b.tournamentId) ?? ''
      return db > da ? 1 : db < da ? -1 : b.kills - a.kills
    })
  }, [killClub100, tournamentStartDateById])

  const killClubAggregate = useMemo(() => {
    type Agg = { playerId: string | null; nickname: string; count: number; entries: KillClub100Entry[] }
    const map = new Map<string, Agg>()
    for (const e of killClubRecent) {
      const key = e.playerId ?? `pubg:${e.nickname.toLowerCase()}`
      const agg = map.get(key) ?? { playerId: e.playerId, nickname: e.nickname, count: 0, entries: [] }
      agg.count++
      agg.entries.push(e)
      map.set(key, agg)
    }
    return [...map.values()].sort((a, b) => b.count !== a.count ? b.count - a.count : a.nickname.localeCompare(b.nickname))
  }, [killClubRecent])

  // 최근기록: 대회별 그룹 (tournament order preserved from killClubRecent)
  const killClubByTournament = useMemo(() => {
    const map = new Map<string, { tournamentId: string; tournamentName: string; entries: KillClub100Entry[] }>()
    for (const e of killClubRecent) {
      if (!map.has(e.tournamentId)) map.set(e.tournamentId, { tournamentId: e.tournamentId, tournamentName: e.tournamentName, entries: [] })
      map.get(e.tournamentId)!.entries.push(e)
    }
    for (const g of map.values()) g.entries.sort((a, b) => b.kills - a.kills)
    return [...map.values()]
  }, [killClubRecent])

  // 선수 종합기록: 횟수별 그룹
  const killClubByCount = useMemo(() => {
    type AggEntry = { playerId: string | null; nickname: string; count: number; entries: KillClub100Entry[] }
    const map = new Map<number, AggEntry[]>()
    for (const agg of killClubAggregate) {
      if (!map.has(agg.count)) map.set(agg.count, [])
      map.get(agg.count)!.push(agg)
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [killClubAggregate])

  const podiumTop3Teams = teamWinRanking.slice(0, 3)
  const podiumRestTeams = teamWinRanking.slice(3)
  const podiumTop3Players = playerWinRanking.slice(0, 3)
  const podiumRestPlayers = playerWinRanking.slice(3)

  // suppress unused warning
  void tag

  return (
    <div>
      {/* 메인 탭 */}
      <div className="flex border-b border-gray-200 mb-4 bg-white rounded-t-xl overflow-x-auto">
        {tabBtn('champions', '역대 우승')}
        {tabBtn('tournaments', '대회 목록')}
        {tabBtn('teams', '팀 통계')}
        {tabBtn('players', '선수 통계')}
      </div>

      {/* 역대 우승 */}
      {tab === 'champions' && (
        <div>
          {/* 서브탭: 팀 / 선수 */}
          <div className="flex gap-1 mb-4 border-b border-gray-100">
            {winnersSubBtn('team', '팀')}
            {winnersSubBtn('player', '선수')}
          </div>

          {/* 팀 서브탭 */}
          {winnersSubTab === 'team' && (
            <div className="flex gap-5 items-start flex-col lg:flex-row">
              {/* 왼쪽: 단상 + 4위 이하 */}
              <div className="flex-1 min-w-0">
                {podiumTop3Teams.length > 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
                    <div className="flex items-end justify-center gap-3">
                      {[
                        podiumTop3Teams[1] ? { team: podiumTop3Teams[1], style: PODIUM_STYLE[0] } : null,
                        podiumTop3Teams[0] ? { team: podiumTop3Teams[0], style: PODIUM_STYLE[1] } : null,
                        podiumTop3Teams[2] ? { team: podiumTop3Teams[2], style: PODIUM_STYLE[2] } : null,
                      ].map((item, idx) => {
                        if (!item) return <div key={idx} className="w-28" />
                        const { team, style } = item
                        return (
                          <div key={team.teamId ?? team.teamName} className="flex flex-col items-center gap-1.5 w-28">
                            <span className="text-xl">{style.medal}</span>
                            {team.logoUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={team.logoUrl} alt={team.teamName} className="w-10 h-10 rounded object-contain" />
                            )}
                            {team.teamId ? (
                              <Link href={`/teams/${team.teamId}`} className="text-xs font-semibold text-gray-800 hover:text-yellow-600 text-center leading-tight">
                                {team.teamName}
                              </Link>
                            ) : (
                              <span className="text-xs font-semibold text-gray-800 text-center leading-tight">{team.teamName}</span>
                            )}
                            <span className="text-xs text-gray-500">{team.count}회 우승</span>
                            <div className={`w-full ${style.height} ${style.bg} rounded-t-lg flex items-center justify-center`}>
                              <span className={`text-lg font-bold ${style.textColor}`}>{style.label}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 mb-4">
                    우승 데이터가 없습니다
                  </div>
                )}
                {podiumRestTeams.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">그 외 우승팀</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {podiumRestTeams.map((team, idx) => (
                        <div key={team.teamId ?? team.teamName} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-sm font-medium text-gray-400 w-5 shrink-0">{idx + 4}</span>
                          {team.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={team.logoUrl} alt={team.teamName} className="w-6 h-6 rounded object-contain shrink-0" />
                          )}
                          {team.teamId ? (
                            <Link href={`/teams/${team.teamId}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600 flex-1 min-w-0 truncate">
                              {team.teamName}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">{team.teamName}</span>
                          )}
                          <span className="text-xs text-gray-400 shrink-0">{team.count}회</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 오른쪽: 대회별 우승팀 리스트 */}
              <div className="w-full lg:w-72 shrink-0">
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">대회별 우승팀</span>
                  </div>
                  <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                    {tournaments.map((t) => {
                      const champ = championMap.get(t.id)
                      return (
                        <div key={t.id} className="px-4 py-2.5">
                          <Link href={`/tournaments/${t.id}`} className="text-xs text-gray-500 hover:text-yellow-600 transition-colors block truncate mb-1">
                            {t.name}
                          </Link>
                          {champ ? (
                            <div className="flex items-center gap-1.5">
                              <TeamLogo url={champ.logoUrl} name={champ.teamName} />
                              {champ.teamId ? (
                                <Link href={`/teams/${champ.teamId}`} className="text-sm font-semibold text-gray-900 hover:text-yellow-600 transition-colors truncate">
                                  {champ.teamName}
                                </Link>
                              ) : (
                                <span className="text-sm font-semibold text-gray-900 truncate">{champ.teamName}</span>
                              )}
                              <span className="text-sm ml-auto shrink-0">🏆</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">데이터 없음</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 선수 서브탭 */}
          {winnersSubTab === 'player' && (
            <div className="flex gap-5 items-start flex-col lg:flex-row">
              {/* 왼쪽: 선수 단상 + 4위 이하 */}
              <div className="flex-1 min-w-0">
                {podiumTop3Players.length > 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
                    <div className="flex items-end justify-center gap-3">
                      {[
                        podiumTop3Players[1] ? { p: podiumTop3Players[1], style: PODIUM_STYLE[0] } : null,
                        podiumTop3Players[0] ? { p: podiumTop3Players[0], style: PODIUM_STYLE[1] } : null,
                        podiumTop3Players[2] ? { p: podiumTop3Players[2], style: PODIUM_STYLE[2] } : null,
                      ].map((item, idx) => {
                        if (!item) return <div key={idx} className="w-28" />
                        const { p, style } = item
                        return (
                          <div key={p.playerId ?? p.nickname} className="flex flex-col items-center gap-1.5 w-28">
                            <span className="text-xl">{style.medal}</span>
                            {p.logoUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.logoUrl} alt={p.teamName} className="w-10 h-10 rounded object-contain" />
                            )}
                            {p.playerId ? (
                              <Link href={`/players/${p.playerId}`} className="text-xs font-semibold text-gray-800 hover:text-yellow-600 text-center leading-tight">
                                {p.nickname}
                              </Link>
                            ) : (
                              <span className="text-xs font-semibold text-gray-800 text-center leading-tight">{p.nickname}</span>
                            )}
                            {p.teamName && (
                              <span className="text-[10px] text-gray-400 text-center leading-tight truncate w-full px-1">{p.teamName}</span>
                            )}
                            <span className="text-xs text-gray-500">{p.wins}회 우승</span>
                            <div className={`w-full ${style.height} ${style.bg} rounded-t-lg flex items-center justify-center`}>
                              <span className={`text-lg font-bold ${style.textColor}`}>{style.label}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 mb-4">
                    우승 데이터가 없습니다
                  </div>
                )}
                {podiumRestPlayers.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">그 외 우승 선수</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {podiumRestPlayers.map((p, idx) => (
                        <div key={p.playerId ?? p.nickname} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-sm font-medium text-gray-400 w-5 shrink-0">{idx + 4}</span>
                          {p.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.logoUrl} alt={p.teamName} className="w-6 h-6 rounded object-contain shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            {p.playerId ? (
                              <Link href={`/players/${p.playerId}`} className="text-sm font-medium text-gray-800 hover:text-yellow-600 block truncate">
                                {p.nickname}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-gray-800 block truncate">{p.nickname}</span>
                            )}
                            {p.teamName && <span className="text-xs text-gray-400 truncate block">{p.teamName}</span>}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">{p.wins}회</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 오른쪽: 대회별 우승팀 선수 리스트 */}
              <div className="w-full lg:w-72 shrink-0">
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">대회별 우승 선수</span>
                  </div>
                  <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                    {tournaments.map((t) => {
                      const entry = champPlayerMap.get(t.id)
                      const expanded = expandedChampTournaments.has(t.id)
                      const PREVIEW = 3
                      return (
                        <div key={t.id} className="px-4 py-2.5">
                          <Link href={`/tournaments/${t.id}`} className="text-xs text-gray-500 hover:text-yellow-600 transition-colors block truncate mb-1">
                            {t.name}
                          </Link>
                          {entry && entry.players.length > 0 ? (
                            <div>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <TeamLogo url={entry.logoUrl} name={entry.teamName} />
                                <span className="text-xs font-medium text-gray-600 truncate">{entry.teamName}</span>
                                <span className="text-xs ml-auto shrink-0">🏆</span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(expanded ? entry.players : entry.players.slice(0, PREVIEW)).map((p) => (
                                  <span key={p.playerId ?? p.nickname}>
                                    {p.playerId ? (
                                      <Link href={`/players/${p.playerId}`} className="text-xs text-gray-600 bg-gray-100 hover:bg-yellow-50 hover:text-yellow-700 px-1.5 py-0.5 rounded transition-colors">
                                        {p.nickname}
                                      </Link>
                                    ) : (
                                      <span className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{p.nickname}</span>
                                    )}
                                  </span>
                                ))}
                                {!expanded && entry.players.length > PREVIEW && (
                                  <button
                                    onClick={() => toggleChampTournament(t.id)}
                                    className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 transition-colors"
                                  >
                                    +{entry.players.length - PREVIEW}명
                                  </button>
                                )}
                                {expanded && entry.players.length > PREVIEW && (
                                  <button
                                    onClick={() => toggleChampTournament(t.id)}
                                    className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 transition-colors"
                                  >
                                    접기
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">데이터 없음</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 대회 목록 */}
      {tab === 'tournaments' && (
        <div className="space-y-3">
          {tournaments.length === 0 && (
            <p className="text-gray-400 text-center py-16">대회 데이터가 없습니다</p>
          )}
          {tournaments.map((t) => {
            const champ = championMap.get(t.id)
            return (
              <Link
                key={t.id}
                href={`/tournaments/${t.id}`}
                className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-yellow-400 hover:shadow-sm transition-all"
              >
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                {t.banner_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.banner_url} alt="" className="w-8 h-8 rounded object-contain border border-gray-100 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                  {t.region && <p className="text-xs text-gray-500">{t.region}</p>}
                </div>
                {champ && (
                  <div className="hidden sm:flex items-center gap-1.5 text-sm text-gray-600 shrink-0">
                    <TeamLogo url={champ.logoUrl} name={champ.teamName} />
                    <span className="font-medium">{champ.teamName}</span>
                    <span className="text-xs text-gray-400">🏆</span>
                  </div>
                )}
                <div className="text-right shrink-0">
                  {(t.start_date || t.end_date) && (
                    <p className="text-xs text-gray-400">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
                  )}
                  {t.prize_pool != null && (
                    <p className="text-sm font-medium text-yellow-600">{formatPrize(t.prize_pool, t.currency)}</p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* 팀 통계 */}
      {tab === 'teams' && (
        <div>
          <div className="mb-3">
            <input
              type="text"
              placeholder="팀 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-yellow-400"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                  <SortTh label="팀" sortKey="teamName" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="대회" sortKey="tournaments" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="경기" sortKey="matches" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="1위" sortKey="wins" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="총 킬" sortKey="kills" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="킬/경기" sortKey="kpg" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="총 데미지" sortKey="damage" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                  <SortTh label="ADR" sortKey="adr" currentKey={teamSortKey} dir={teamSortDir} onSort={toggleTeamSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedTeams.map((t, i) => {
                  const key = t.teamId ?? t.teamName
                  const expanded = expandedTeams.has(key)
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => toggleTeam(key)} className="hover:bg-gray-50 transition-colors cursor-pointer select-none">
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-300 text-[10px] w-3 shrink-0">{expanded ? '▼' : '▶'}</span>
                            <TeamLogo url={t.logoUrl} name={t.teamName} />
                            {t.teamId ? (
                              <Link href={`/teams/${t.teamId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-900 hover:text-yellow-600 transition-colors">
                                {t.teamName}
                              </Link>
                            ) : (
                              <span className="font-medium text-gray-900">{t.teamName}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{t.tournaments}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{t.matches}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{t.wins}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-900">{t.kills}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{t.matches > 0 ? (t.kills / t.matches).toFixed(2) : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{Math.round(t.damage).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{t.matches > 0 ? Math.round(t.damage / t.matches).toLocaleString() : '—'}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={9} className="px-0 py-0 border-b border-gray-100">
                            <div className="bg-gray-50/60 px-10 py-2">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 border-b border-gray-200">
                                    <th className="pb-1.5 text-left font-medium">대회</th>
                                    <th className="pb-1.5 pr-3 text-right font-medium">경기</th>
                                    <th className="pb-1.5 pr-3 text-right font-medium">1위</th>
                                    <th className="pb-1.5 pr-3 text-right font-medium">킬</th>
                                    <th className="pb-1.5 pr-3 text-right font-medium">킬/경기</th>
                                    <th className="pb-1.5 pr-3 text-right font-medium">데미지</th>
                                    <th className="pb-1.5 text-right font-medium">ADR</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.breakdown.map((b) => (
                                    <tr key={b.tournamentId} className="border-b border-gray-100 last:border-0">
                                      <td className="py-1.5">
                                        <Link href={`/tournaments/${b.tournamentId}`} className="text-gray-700 hover:text-yellow-600 font-medium">
                                          {b.tournamentName}
                                        </Link>
                                      </td>
                                      <td className="py-1.5 pr-3 text-right text-gray-600">{b.matches}</td>
                                      <td className="py-1.5 pr-3 text-right text-gray-600">{b.wins}</td>
                                      <td className="py-1.5 pr-3 text-right text-gray-700 font-medium">{b.kills}</td>
                                      <td className="py-1.5 pr-3 text-right text-gray-600">{b.matches > 0 ? (b.kills / b.matches).toFixed(2) : '—'}</td>
                                      <td className="py-1.5 pr-3 text-right text-gray-600">{Math.round(b.damage).toLocaleString()}</td>
                                      <td className="py-1.5 text-right text-gray-600">{b.matches > 0 ? Math.round(b.damage / b.matches).toLocaleString() : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {sortedTeams.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-gray-400 py-12">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 선수 통계 */}
      {tab === 'players' && (
        <div>
          <div className="flex gap-1 mb-4 border-b border-gray-100">
            <button
              onClick={() => setPlayerSubTab('total')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${playerSubTab === 'total' ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              전체
            </button>
            <button
              onClick={() => setPlayerSubTab('killclub')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${playerSubTab === 'killclub' ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              100킬 클럽
              {killClub100.length > 0 && (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">{killClub100.length}</span>
              )}
            </button>
          </div>

          {playerSubTab === 'total' && (
            <div>
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="선수/팀 검색..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full sm:w-64 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-yellow-400"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                      <SortTh label="선수" sortKey="nickname" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="팀" sortKey="teamName" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="대회" sortKey="tournaments" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="경기" sortKey="matches" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="총 킬" sortKey="kills" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="킬/경기" sortKey="kpg" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="어시스트" sortKey="assists" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="넉다운" sortKey="knocks" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="데미지" sortKey="damage" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                      <SortTh label="ADR" sortKey="adr" currentKey={playerSortKey} dir={playerSortDir} onSort={togglePlayerSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedPlayers.map((p, i) => {
                      const key = p.playerId ?? p.nickname
                      const expanded = expandedPlayers.has(key)
                      return (
                        <Fragment key={key}>
                          <tr onClick={() => togglePlayer(key)} className="hover:bg-gray-50 transition-colors cursor-pointer select-none">
                            <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-gray-300 text-[10px] w-3 shrink-0">{expanded ? '▼' : '▶'}</span>
                                {p.playerId ? (
                                  <Link href={`/players/${p.playerId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-900 hover:text-yellow-600 transition-colors">
                                    {p.nickname}
                                  </Link>
                                ) : (
                                  <span className="font-medium text-gray-900">{p.nickname}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <TeamLogo url={p.logoUrl} name={p.teamName} />
                                {p.teamId ? (
                                  <Link href={`/teams/${p.teamId}`} onClick={(e) => e.stopPropagation()} className="text-gray-600 hover:text-yellow-600 transition-colors">
                                    {p.teamName}
                                  </Link>
                                ) : (
                                  <span className="text-gray-600">{p.teamName}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{p.tournaments}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{p.matches}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-gray-900">{p.kills}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{p.matches > 0 ? (p.kills / p.matches).toFixed(2) : '—'}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{p.assists}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{p.knocks}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{Math.round(p.damage).toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{p.matches > 0 ? Math.round(p.damage / p.matches).toLocaleString() : '—'}</td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={11} className="px-0 py-0 border-b border-gray-100">
                                <div className="bg-gray-50/60 px-10 py-2">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400 border-b border-gray-200">
                                        <th className="pb-1.5 text-left font-medium">대회</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">경기</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">킬</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">킬/경기</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">어시스트</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">넉다운</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">데미지</th>
                                        <th className="pb-1.5 text-right font-medium">ADR</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {p.breakdown.map((b) => (
                                        <tr key={b.tournamentId} className="border-b border-gray-100 last:border-0">
                                          <td className="py-1.5">
                                            <Link href={`/tournaments/${b.tournamentId}`} className="text-gray-700 hover:text-yellow-600 font-medium">
                                              {b.tournamentName}
                                            </Link>
                                          </td>
                                          <td className="py-1.5 pr-3 text-right text-gray-600">{b.matches}</td>
                                          <td className="py-1.5 pr-3 text-right text-gray-700 font-medium">{b.kills}</td>
                                          <td className="py-1.5 pr-3 text-right text-gray-600">{b.matches > 0 ? (b.kills / b.matches).toFixed(2) : '—'}</td>
                                          <td className="py-1.5 pr-3 text-right text-gray-600">{b.assists}</td>
                                          <td className="py-1.5 pr-3 text-right text-gray-600">{b.knocks}</td>
                                          <td className="py-1.5 pr-3 text-right text-gray-600">{Math.round(b.damage).toLocaleString()}</td>
                                          <td className="py-1.5 text-right text-gray-600">{b.matches > 0 ? Math.round(b.damage / b.matches).toLocaleString() : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                    {sortedPlayers.length === 0 && (
                      <tr><td colSpan={11} className="text-center text-gray-400 py-12">데이터가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {playerSubTab === 'killclub' && (
            <div>
              <p className="text-xs text-gray-400 mb-4">한 대회에서 100킬 이상을 달성한 선수 기록입니다. 통계 재계산 후 갱신됩니다.</p>
              {killClub100.length === 0 ? (
                <div className="text-center text-gray-400 py-16">
                  <p className="text-2xl mb-2">🏆</p>
                  <p>100킬 클럽 기록이 없습니다</p>
                  <p className="text-xs mt-1">각 대회에서 통계 재계산을 실행하면 자동으로 집계됩니다</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* 최근기록 — 대회별 그룹 */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-gray-900">최근기록</h3>
                      <span className="text-xs text-gray-400">{killClubRecent.length}건 · {killClubByTournament.length}개 대회</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {killClubByTournament.map((group) => (
                        <div key={group.tournamentId}>
                          {/* 대회 헤더 */}
                          <Link
                            href={`/tournaments/${group.tournamentId}`}
                            className="px-4 py-2 bg-gray-50/80 flex items-center justify-between hover:bg-yellow-50 transition-colors group"
                          >
                            <span className="text-xs font-semibold text-gray-600 group-hover:text-yellow-600 transition-colors truncate">{group.tournamentName}</span>
                            <span className="text-xs text-gray-400 ml-2 shrink-0">{group.entries.length}명</span>
                          </Link>
                          {/* 선수 리스트 */}
                          {group.entries.map((e) => (
                            <div key={e.nickname} className="px-4 py-2.5 pl-7 flex items-center gap-2 border-t border-gray-50">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {e.playerId ? (
                                    <Link href={`/players/${e.playerId}`} className="font-semibold text-sm text-gray-900 hover:text-yellow-600 transition-colors">
                                      {e.nickname}
                                    </Link>
                                  ) : (
                                    <span className="font-semibold text-sm text-gray-900">{e.nickname}</span>
                                  )}
                                  <span className="text-gray-200 text-xs">|</span>
                                  <div className="flex items-center gap-1 text-xs text-gray-500">
                                    {e.logoUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={e.logoUrl} alt={e.teamName} className="w-3.5 h-3.5 rounded object-contain shrink-0" />
                                    )}
                                    {e.teamId ? (
                                      <Link href={`/teams/${e.teamId}`} className="hover:text-yellow-600 transition-colors">{e.teamName}</Link>
                                    ) : (
                                      <span>{e.teamName}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-bold text-yellow-600 text-sm">{e.kills}킬</span>
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{e.games}경기</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 선수 종합기록 — 횟수별 그룹 */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-gray-900">선수 종합기록</h3>
                      <span className="text-xs text-gray-400">{killClubAggregate.length}명</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {killClubByCount.map(([count, players]) => {
                        const groupKey = `count:${count}`
                        const groupExpanded = expandedKillClubGroups.has(groupKey)
                        return (
                          <div key={count}>
                            {/* 횟수 그룹 헤더 */}
                            <button
                              onClick={() => toggleKillClubGroup(groupKey)}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                            >
                              <div className="w-9 h-9 rounded-full bg-yellow-50 border-2 border-yellow-300 flex flex-col items-center justify-center shrink-0">
                                <span className="text-sm font-bold text-yellow-600 leading-none">{count}</span>
                                <span className="text-[8px] text-yellow-500 leading-none">회</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-500 truncate">
                                  {players.slice(0, 4).map((p) => p.nickname).join(' · ')}
                                  {players.length > 4 && <span className="text-gray-400"> 외 {players.length - 4}명</span>}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">{players.length}명 · {count}회 달성</p>
                              </div>
                              <span className="text-gray-300 text-[10px] shrink-0">{groupExpanded ? '▼' : '▶'}</span>
                            </button>

                            {/* 그룹 펼치기 — 개별 선수 목록 */}
                            {groupExpanded && (
                              <div className="bg-gray-50/60 divide-y divide-gray-100 border-t border-gray-100">
                                {players.map((agg) => {
                                  const playerKey = agg.playerId ?? `pubg:${agg.nickname.toLowerCase()}`
                                  const playerExpanded = expandedKillClub.has(playerKey)
                                  return (
                                    <div key={playerKey}>
                                      <button
                                        onClick={() => toggleKillClub(playerKey)}
                                        className="w-full px-4 py-2.5 pl-8 flex items-center gap-2 hover:bg-gray-100/60 transition-colors text-left"
                                      >
                                        <div className="flex-1 min-w-0">
                                          {agg.playerId ? (
                                            <Link
                                              href={`/players/${agg.playerId}`}
                                              onClick={(e) => e.stopPropagation()}
                                              className="font-semibold text-sm text-gray-900 hover:text-yellow-600 transition-colors"
                                            >
                                              {agg.nickname}
                                            </Link>
                                          ) : (
                                            <span className="font-semibold text-sm text-gray-900">{agg.nickname}</span>
                                          )}
                                        </div>
                                        <span className="text-gray-300 text-[10px] shrink-0">{playerExpanded ? '▼' : '▶'}</span>
                                      </button>
                                      {playerExpanded && (
                                        <div className="px-4 pb-3 pt-1 pl-8 bg-gray-100/30 space-y-1.5">
                                          {agg.entries.map((e) => (
                                            <div key={e.tournamentId} className="flex items-center gap-2 text-xs bg-white border border-gray-100 rounded-lg px-3 py-2">
                                              <Link href={`/tournaments/${e.tournamentId}`} className="text-gray-600 hover:text-yellow-600 transition-colors flex-1 min-w-0 truncate font-medium">
                                                {e.tournamentName}
                                              </Link>
                                              <span className="text-gray-400 shrink-0">{e.games}경기</span>
                                              <span className="font-bold text-yellow-600 shrink-0">{e.kills}킬</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
