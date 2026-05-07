'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { CircuitChampion, CircuitTeamStat, CircuitPlayerStat } from './page'
import { formatPrize } from '@/lib/currency'

type Tab = 'tournaments' | 'champions' | 'teams' | 'players'

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
}: {
  tag: string
  tournaments: Tournament[]
  champions: CircuitChampion[]
  teamStats: CircuitTeamStat[]
  playerStats: CircuitPlayerStat[]
}) {
  const [tab, setTab] = useState<Tab>('tournaments')
  const [teamSortKey, setTeamSortKey] = useState<TeamSortKey>('kills')
  const [teamSortDir, setTeamSortDir] = useState<'asc' | 'desc'>('desc')
  const [playerSortKey, setPlayerSortKey] = useState<PlayerSortKey>('kills')
  const [playerSortDir, setPlayerSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

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
                {sortedTeams.map((t, i) => (
                  <tr key={t.teamId ?? t.teamName} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <TeamLogo url={t.logoUrl} name={t.teamName} />
                        {t.teamId ? (
                          <Link href={`/teams/${t.teamId}`} className="font-medium text-gray-900 hover:text-yellow-600 transition-colors">
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
                ))}
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
                {sortedPlayers.map((p, i) => (
                  <tr key={p.playerId ?? p.nickname} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      {p.playerId ? (
                        <Link href={`/players/${p.playerId}`} className="font-medium text-gray-900 hover:text-yellow-600 transition-colors">
                          {p.nickname}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900">{p.nickname}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.teamId ? (
                        <div className="flex items-center gap-1.5">
                          <TeamLogo url={p.logoUrl} name={p.teamName} />
                          <Link href={`/teams/${p.teamId}`} className="text-gray-600 hover:text-yellow-600 transition-colors">
                            {p.teamName}
                          </Link>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
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
                ))}
                {sortedPlayers.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-gray-400 py-12">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
