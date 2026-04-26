'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import Pagination from '@/components/Pagination'

const STATUS_LABEL: Record<string, string> = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

export default function AdminTournamentListClient({ tournaments }: { tournaments: Tournament[] }) {
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
          <button onClick={() => selectYear('')} className={yearBtnCls(!filterYear)}>All Years</button>
          {years.map(y => (
            <button key={y} onClick={() => selectYear(y)} className={yearBtnCls(filterYear === y)}>{y}</button>
          ))}
        </div>
      )}

      {paginated.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          No tournaments registered
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Period</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Region</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900">{t.name}</p>
                    {t.short_name && <p className="text-xs text-gray-400 font-mono">{t.short_name}</p>}
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {t.start_date ?? '-'} ~ {t.end_date ?? '-'}
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{t.region ?? '-'}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/tournaments/${t.id}`} className="text-xs font-medium text-yellow-600 hover:text-yellow-700">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
