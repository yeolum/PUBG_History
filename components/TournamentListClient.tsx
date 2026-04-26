'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import Pagination from './Pagination'

const STATUS_LABEL: Record<string, string> = { upcoming: '예정', ongoing: '진행중', completed: '종료' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

export default function TournamentListClient({ tournaments }: { tournaments: Tournament[] }) {
  const years = [...new Set(tournaments.map(t => t.start_date?.slice(0, 4)).filter(Boolean))].sort().reverse() as string[]

  const [filterYear, setFilterYear] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const filtered = tournaments.filter(t => !filterYear || t.start_date?.startsWith(filterYear))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  function selectYear(year: string) {
    setFilterYear(year)
    setPage(1)
  }

  const yearBtnCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
      active ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-400'
    }`

  return (
    <>
      {years.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={() => selectYear('')} className={yearBtnCls(!filterYear)}>전체</button>
          {years.map(y => (
            <button key={y} onClick={() => selectYear(y)} className={yearBtnCls(filterYear === y)}>{y}</button>
          ))}
        </div>
      )}

      {paginated.length === 0 ? (
        <p className="text-gray-400 text-center py-20">등록된 대회가 없습니다</p>
      ) : (
        <div className="space-y-3">
          {paginated.map(t => (
            <Link
              key={t.id}
              href={`/tournaments/${t.id}`}
              className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-yellow-400 hover:shadow-sm transition-all"
            >
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[t.status]}`}>
                {STATUS_LABEL[t.status]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                {t.region && <p className="text-xs text-gray-500">{t.region}</p>}
              </div>
              <div className="text-right shrink-0">
                {(t.start_date || t.end_date) && (
                  <p className="text-xs text-gray-400">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
                )}
                {t.prize_pool && <p className="text-sm font-medium text-yellow-600">{t.prize_pool}</p>}
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
