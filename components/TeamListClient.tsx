'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Team } from '@/lib/types'
import Pagination from './Pagination'

interface TeamWithAliases extends Team {
  team_aliases?: { alias: string }[]
}

export default function TeamListClient({ teams }: { teams: TeamWithAliases[] }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [filterLeague, setFilterLeague] = useState('')

  const leagues = useMemo(
    () => [...new Set(teams.map(t => t.league).filter(Boolean))].sort() as string[],
    [teams]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return teams.filter(t => {
      const matchSearch = !q ||
        t.name.toLowerCase().includes(q) ||
        (t.short_name ?? '').toLowerCase().includes(q) ||
        (t.team_aliases ?? []).some(a => a.alias.toLowerCase().includes(q))
      const matchLeague = !filterLeague || t.league === filterLeague
      return matchSearch && matchLeague
    })
  }, [teams, search, filterLeague])

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

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

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-20">No teams found</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {paginated.map(team => (
            <Link
              key={team.id}
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
              {team.league && <p className="text-xs text-blue-500 mt-0.5">{team.league}</p>}
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
