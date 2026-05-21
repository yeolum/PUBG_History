'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Team } from '@/lib/types'
import Pagination from './Pagination'

interface TeamWithAliases extends Team {
  team_aliases?: { alias: string }[]
}

const IS_PNC = (t: TeamWithAliases) => t.league?.toLowerCase() === 'pnc'

type Tab = 'teams' | 'national'

export default function TeamListClient({ teams, tournamentTeamIds = [] }: { teams: TeamWithAliases[]; tournamentTeamIds?: string[] }) {
  const [tab, setTab] = useState<Tab>('teams')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [search, setSearch] = useState('')

  const ttIdSet = useMemo(() => new Set(tournamentTeamIds), [tournamentTeamIds])

  const sortByTournamentFirst = (a: TeamWithAliases, b: TeamWithAliases) => {
    const aIn = ttIdSet.has(a.id) ? 0 : 1
    const bIn = ttIdSet.has(b.id) ? 0 : 1
    if (aIn !== bIn) return aIn - bIn
    return a.name.localeCompare(b.name)
  }

  const regularTeams = useMemo(
    () => teams.filter(t => !IS_PNC(t)).sort(sortByTournamentFirst),
    [teams, ttIdSet]
  )
  const pncTeams = useMemo(
    () => teams.filter(IS_PNC).sort(sortByTournamentFirst),
    [teams, ttIdSet]
  )

  const filteredRegular = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return regularTeams
    return regularTeams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.short_name ?? '').toLowerCase().includes(q) ||
      (t.team_aliases ?? []).some(a => a.alias.toLowerCase().includes(q))
    )
  }, [regularTeams, search])

  const filteredPnc = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return pncTeams
    return pncTeams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.short_name ?? '').toLowerCase().includes(q) ||
      (t.team_aliases ?? []).some(a => a.alias.toLowerCase().includes(q))
    )
  }, [pncTeams, search])

  const activeList = tab === 'teams' ? filteredRegular : filteredPnc
  const paginated = activeList.slice((page - 1) * pageSize, page * pageSize)

  function switchTab(next: Tab) {
    setTab(next)
    setPage(1)
    setSearch('')
  }

  const TeamCard = ({ team }: { team: TeamWithAliases }) => (
    <Link
      href={`/teams/${team.id}`}
      className="bg-white rounded-lg border border-gray-200 px-3 py-2 hover:border-yellow-400 hover:shadow-sm transition-all flex items-center gap-2.5"
    >
      <div className="w-7 h-7 bg-gray-100 rounded flex items-center justify-center overflow-hidden shrink-0">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
        ) : (
          <span className="text-xs font-bold text-gray-400">{team.name[0]}</span>
        )}
      </div>
      <p className="font-medium text-gray-900 text-xs truncate">{team.name}</p>
    </Link>
  )

  return (
    <>
      {/* Tab toggle */}
      {pncTeams.length > 0 && (
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => switchTab('teams')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${tab === 'teams' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Teams
          </button>
          <button
            onClick={() => switchTab('national')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${tab === 'national' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            National Teams
          </button>
        </div>
      )}

      {/* Search */}
      <div className="mb-5">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by name, tag, former name..."
          className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        {search && (
          <p className="text-xs text-gray-400 mt-2">{activeList.length} teams found</p>
        )}
      </div>

      {/* Grid */}
      {activeList.length === 0 ? (
        <p className="text-gray-400 text-center py-20">No teams found</p>
      ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {paginated.map(team => <TeamCard key={team.id} team={team} />)}
        </div>
      )}

      <Pagination
        total={activeList.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </>
  )
}
