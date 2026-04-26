'use client'

import { useState } from 'react'
import Link from 'next/link'
import Pagination from './Pagination'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PlayerListClient({ players }: { players: any[] }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const paginated = players.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      {players.length === 0 ? (
        <p className="text-gray-400 text-center py-20">등록된 선수가 없습니다</p>
      ) : (
        <div className="grid gap-3">
          {paginated.map(p => (
            <Link
              key={p.id}
              href={`/players/${p.id}`}
              className="bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-yellow-400 hover:shadow-sm transition-all flex items-center gap-4"
            >
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                {p.profile_pic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.profile_pic} alt={p.nickname} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-gray-400">{p.nickname[0]}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{p.nickname}</p>
                {p.real_name && <p className="text-xs text-gray-500">{p.real_name}</p>}
              </div>
              {p.teams && (
                <span className="text-sm text-gray-500 shrink-0">{p.teams.name}</span>
              )}
              {p.nationality && (
                <span className="text-xs text-gray-400 shrink-0">{p.nationality}</span>
              )}
            </Link>
          ))}
        </div>
      )}

      <Pagination
        total={players.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </>
  )
}
