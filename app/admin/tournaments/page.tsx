import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Tournament Management' }

const STATUS_LABEL: Record<string, string> = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

export default async function AdminTournamentsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .order('start_date', { ascending: false })

  const tournaments = (data ?? []) as Tournament[]

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Tournament Management</h1>
        <Link
          href="/admin/tournaments/new"
          className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
        >
          + New Tournament
        </Link>
      </div>

      {tournaments.length === 0 ? (
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
              {tournaments.map((t) => (
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
                    <Link
                      href={`/admin/tournaments/${t.id}`}
                      className="text-xs font-medium text-yellow-600 hover:text-yellow-700"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
