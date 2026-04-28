'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Team } from '@/lib/types'
import Pagination from './Pagination'

interface TeamWithAliases extends Team {
  team_aliases?: { alias: string }[]
}

const IS_PNC = (t: TeamWithAliases) => t.league?.toLowerCase() === 'pnc'

export default function TeamListClient({ teams }: { teams: TeamWithAliases[] }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [filterLeague, setFilterLeague] = useState('')

  const regularTeams = useMemo(() => teams.filter(t => !IS_PNC(t)), [teams])
  const pncTeams = useMemo(() => teams.filter(IS_PNC), [teams])

  const leagues = useMemo(
    () => [...new Set(regularTeams.map(t => t.league).filter(Boolean))].sort() as string[],
    [regularTeams]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return regularTeams.filter(t => {
      const matchSearch = !q ||
        t.name.toLowerCase().includes(q) ||
        (t.short_name ?? '').toLowerCase().includes(q) ||
        (t.team_aliases ?? []).some(a => a.alias.toLowerCase().includes(q))
      const matchLeague = !filterLeague || t.league === filterLeague
      return matchSearch && matchLeague
    })
  }, [regularTeams, search, filterLeague])

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const pncFiltered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return pncTeams
    return pncTeams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.short_name ?? '').toLowerCase().includes(q) ||
      (t.team_aliases ?? []).some(a => a.alias.toLowerCase().includes(q))
    )
  }, [pncTeams, search])

  const TeamCard = ({ team }: { team: TeamWithAliases }) => (
    <Link
      href={`/teams/${team.id}`}
      className="bg-white rounded-xl border border-gray-200 p-4 hover:border-yellow-400 hover:shadow-md transition-all"
    >
      <div className="mb-3 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
        ) : (
          <span className="text-base font-bold text-gray-400">{team.name[0]}</span>
        )}
      </div>
      <p className="font-semibold text-gray-900 text-sm truncate">{team.name}</p>
      {team.short_name && <p className="text-xs text-gray-400 font-mono mt-0.5">{team.short_name}</p>}
      {team.nationality && <p className="text-xs text-gray-500 mt-0.5">{team.nationality}</p>}
      {team.league && !IS_PNC(team) && <p className="text-xs text-blue-500 mt-0.5">{team.league}</p>}
    </Link>
  )

  return (
    <>
      {/* Search + filters */}
      <div className="mb-5 space-y-3">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by name, tag, former name..."
          className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        {leagues.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => { setFilterLeague(''); setPage(1) }}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${!filterLeague ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
            >
              All
            </button>
            {leagues.map(l => (
              <button
                key={l}
                onClick={() => { setFilterLeague(l === filterLeague ? '' : l); setPage(1) }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filterLeague === l ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {(search || filterLeague) && (
          <p className="text-xs text-gray-400">{filtered.length} teams found</p>
        )}
      </div>

      {/* Regular teams */}
      {filtered.length === 0 && !search ? null : filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-10">No teams found</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {paginated.map(team => <TeamCard key={team.id} team={team} />)}
        </div>
      )}

      <Pagination
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />

      {/* PNC National Teams — separate section */}
      {pncFiltered.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-900">National Teams</h2>
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">PNC</span>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {pncFiltered.map(team => <TeamCard key={team.id} team={team} />)}
          </div>
        </div>
      )}
    </>
  )
}
