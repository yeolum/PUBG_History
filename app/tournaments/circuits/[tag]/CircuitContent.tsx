'use client'

import { useState, useMemo, Fragment } from 'react'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { CircuitChampion, CircuitTeamStat, CircuitPlayerStat, KillClub100Entry } from './page'
import { formatPrize } from '@/lib/currency'

type Tab = 'tournaments' | 'champions' | 'teams' | 'players'
type PlayerSubTab = 'total' | 'killclub'

type TeamSortKey = 'teamName' | 'tournaments' | 'matches' | 'wins' | 'kills' | 'kpg' | 'damage' | 'adr'
type PlayerSortKey = 'nickname' | 'teamName' | 'tournaments' | 'matches' | 'kills' | 'kpg' | 'assists' | 'knocks' | 'damage' | 'adr'

const STATUS_LABEL: Record<string, string> = { upcoming: '예정', ongoing: '진행중', completed: '종료' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

function TeamLogo({ url, name }: { url: string | null; name: string }) {
  if (!url) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} className="w-5 h-5 rounded object-contain shrink-0" />
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

export default function CircuitContent({
  tag,
  tournaments,
  champions,
  teamStats,
  playerStats,
  killClub100,
}: {
  tag: string
  tournaments: Tournament[]
  champions: CircuitChampion[]
  teamStats: CircuitTeamStat[]
  playerStats: CircuitPlayerStat[]
  killClub100: KillClub100Entry[]
}) {
  const [tab, setTab] = useState<Tab>('tournaments')
  const [playerSubTab, setPlayerSubTab] = useState<PlayerSubTab>('total')
  const [teamSortKey, setTeamSortKey] = useState<TeamSortKey>('kills')
  const [teamSortDir, setTeamSortDir] = useState<'asc' | 'desc'>('desc')
  const [playerSortKey, setPlayerSortKey] = useState<PlayerSortKey>('kills')
  const [playerSortDir, setPlayerSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set())
  const [expandedKillClub, setExpandedKillClub] = useState<Set<string>>(new Set())

  function toggleTeam(key: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function togglePlayer(key: string) {
    setExpandedPlayers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function toggleKillClub(key: string) {
    setExpandedKillClub((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const championMap = useMemo(() => {
    const m = new Map<string, CircuitChampion>()
    for (const c of champions) m.set(c.tournamentId, c)
    return m
  }, [champions])

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

  return (
    <div>
      <div className="flex border-b border-gray-200 mb-4 bg-white rounded-t-xl overflow-x-auto">
        {tabBtn('tournaments', '대회 목록')}
        {tabBtn('champions', '역대 우승팀')}
        {tabBtn('teams', '팀 통계')}
        {tabBtn('players', '선수 통계')}
      </div>

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

      {/* 역대 우승팀 */}
      {tab === 'champions' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">대회</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">우승팀</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">경기 수</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">1위 횟수</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">총 킬</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">총 포인트</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tournaments.map((t) => {
                const champ = championMap.get(t.id)
                return (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/tournaments/${t.id}`} className="font-medium text-gray-900 hover:text-yellow-600 transition-colors">
                        {t.name}
                      </Link>
                      {(t.start_date || t.end_date) && (
                        <p className="text-xs text-gray-400 mt-0.5">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {champ ? (
                        <div className="flex items-center gap-2">
                          <TeamLogo url={champ.logoUrl} name={champ.teamName} />
                          {champ.teamId ? (
                            <Link href={`/teams/${champ.teamId}`} className="font-semibold text-gray-900 hover:text-yellow-600 transition-colors">
                              {champ.teamName}
                            </Link>
                          ) : (
                            <span className="font-semibold text-gray-900">{champ.teamName}</span>
                          )}
                          <span className="text-base">🏆</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">데이터 없음</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{champ?.matches ?? '—'}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{champ?.wins ?? '—'}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{champ?.totalKills ?? '—'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900">{champ?.totalPoints ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
                      <tr
                        onClick={() => toggleTeam(key)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer select-none"
                      >
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
          {/* 선수 통계 세부 탭 */}
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

          {/* 전체 탭 */}
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
                          <tr
                            onClick={() => togglePlayer(key)}
                            className="hover:bg-gray-50 transition-colors cursor-pointer select-none"
                          >
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

          {/* 100킬 클럽 탭 */}
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
                  {/* 최근기록 */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <h3 className="font-semibold text-sm text-gray-900">최근기록</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {killClubRecent.map((e) => (
                        <div key={`${e.tournamentId}-${e.nickname}`} className="px-4 py-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="mb-0.5">
                              {e.playerId ? (
                                <Link href={`/players/${e.playerId}`} className="font-semibold text-sm text-gray-900 hover:text-yellow-600 transition-colors">
                                  {e.nickname}
                                </Link>
                              ) : (
                                <span className="font-semibold text-sm text-gray-900">{e.nickname}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap">
                              <TeamLogo url={e.logoUrl} name={e.teamName} />
                              {e.teamId ? (
                                <Link href={`/teams/${e.teamId}`} className="hover:text-yellow-600 transition-colors">{e.teamName}</Link>
                              ) : (
                                <span>{e.teamName}</span>
                              )}
                              <span className="text-gray-300">·</span>
                              <Link href={`/tournaments/${e.tournamentId}`} className="hover:text-yellow-600 transition-colors truncate">{e.tournamentName}</Link>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-yellow-600 text-sm">{e.kills}킬</p>
                            <p className="text-xs text-gray-400">{e.games}경기</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 선수 종합기록 */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <h3 className="font-semibold text-sm text-gray-900">선수 종합기록</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {killClubAggregate.map((agg) => {
                        const key = agg.playerId ?? `pubg:${agg.nickname.toLowerCase()}`
                        const expanded = expandedKillClub.has(key)
                        return (
                          <div key={key}>
                            <button
                              onClick={() => toggleKillClub(key)}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                            >
                              <span className="text-gray-300 text-[10px] shrink-0">{expanded ? '▼' : '▶'}</span>
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
                              <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full shrink-0">{agg.count}회</span>
                            </button>
                            {expanded && (
                              <div className="px-10 pb-3 pt-1 bg-gray-50/60">
                                <div className="space-y-2">
                                  {agg.entries.map((e) => (
                                    <div key={e.tournamentId} className="flex items-center justify-between text-xs">
                                      <Link href={`/tournaments/${e.tournamentId}`} className="text-gray-600 hover:text-yellow-600 transition-colors truncate mr-3">
                                        {e.tournamentName}
                                      </Link>
                                      <div className="flex items-center gap-3 text-gray-500 shrink-0">
                                        <span>{e.games}경기</span>
                                        <span className="font-bold text-yellow-600">{e.kills}킬</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
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
