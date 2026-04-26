'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Team } from '@/lib/types'
import Pagination from './Pagination'

export default function TeamListClient({ teams }: { teams: Team[] }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const paginated = teams.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      {teams.length === 0 ? (
        <p className="text-gray-400 text-center py-20">등록된 팀이 없습니다</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {paginated.map(team => (
            <Link
              key={team.id}
              href={`/teams/${team.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-md transition-all"
            >
              <div className="mb-3 w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                {team.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-lg font-bold text-gray-400">{team.name[0]}</span>
                )}
              </div>
              <p className="font-semibold text-gray-900">{team.name}</p>
              {team.short_name && <p className="text-xs text-gray-400 font-mono mt-0.5">{team.short_name}</p>}
              {team.nationality && <p className="text-xs text-gray-500 mt-1">{team.nationality}</p>}
            </Link>
          ))}
        </div>
      )}

      <Pagination
        total={teams.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </>
  )
}
