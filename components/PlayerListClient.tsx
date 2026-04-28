'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import Pagination from './Pagination'

interface TeamInfo {
  id: string
  name: string
  short_name: string | null
  league: string | null
}

interface PlayerWithTeam {
  id: string
  nickname: string
  real_name: string | null
  nationality: string | null
  profile_pic: string | null
  teams: TeamInfo | null
}

const NONE_KEY = '__NONE__'

export default function PlayerListClient({ players }: { players: PlayerWithTeam[] }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [filterNationality, setFilterNationality] = useState('')
  const [filterLeague, setFilterLeague] = useState<string | null>(null)

  const nationalities = useMemo(
    () => [...new Set(players.map(p => p.nationality).filter(Boolean))].sort() as string[],
    [players]
  )

  const leagues = useMemo(() => {
    const s = new Set<string>()
    players.forEach(p => { if (p.teams?.league) s.add(p.teams.league) })
    return [...s].sort()
  }, [players])

  const hasNone = useMemo(
    () => players.some(p => !p.teams?.league),
    [players]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return players.filter(p => {
      const matchSearch = !q ||
        p.nickname.toLowerCase().includes(q) ||
        (p.real_name ?? '').toLowerCase().includes(q) ||
        (p.teams?.name ?? '').toLowerCase().includes(q) ||
        (p.teams?.short_name ?? '').toLowerCase().includes(q)
      const matchNationality = !filterNationality || p.nationality === filterNationality
      const playerLeague = p.teams?.league ?? null
      const matchLeague =
        filterLeague === null ? true
        : filterLeague === NONE_KEY ? !playerLeague
        : playerLeague === filterLeague
      return matchSearch && matchNationality && matchLeague
    })
  }, [players, search, filterNationality, filterLeague])

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const btnLeague = (key: string | null) =>
    `px-3 py-1.5 text-sm rounded-lg border transition-colors ${filterLeague === key ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`

  return (
    <>
      <div className="mb-5 space-y-3">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by nickname, real name, team..."
          className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />

        {(leagues.length > 0 || hasNone) && (
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => { setFilterLeague(null); setPage(1) }} className={btnLeague(null)}>All</button>
            {leagues.map(l => (
              <button key={l} onClick={() => { setFilterLeague(l === filterLeague ? null : l); setPage(1) }} className={btnLeague(l)}>
                {l}
              </button>
            ))}
            {hasNone && (
              <button onClick={() => { setFilterLeague(filterLeague === NONE_KEY ? null : NONE_KEY); setPage(1) }} className={btnLeague(NONE_KEY)}>
                None
              </button>
            )}
          </div>
        )}

        {nationalities.length > 0 && (
          <select
            value={filterNationality}
            onChange={e => { setFilterNationality(e.target.value); setPage(1) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <option value="">All Nationalities</option>
            {nationalities.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}

        {(search || filterNationality || filterLeague !== null) && (
          <p className="text-xs text-gray-400">{filtered.length} players found</p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-20">No players found</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {paginated.map(p => (
            <Link
              key={p.id}
              href={`/players/${p.id}`}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-yellow-400 hover:shadow-md transition-all flex"
            >
              <div className="w-1/2 shrink-0 bg-gray-100 aspect-square flex items-center justify-center overflow-hidden">
                {p.profile_pic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.profile_pic} alt={p.nickname} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-gray-300">{p.nickname[0]}</span>
                )}
              </div>
              <div className="w-1/2 p-2.5 flex flex-col justify-center min-w-0">
                <p className="font-semibold text-gray-900 text-xs leading-tight truncate">{p.nickname}</p>
                {p.nationality && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{p.nationality}</p>}
                {p.teams && <p className="text-[11px] text-blue-500 mt-0.5 truncate">{p.teams.name}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </>
  )
}
