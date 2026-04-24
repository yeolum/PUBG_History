import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '대회 목록' }

const STATUS_LABEL: Record<string, string> = { upcoming: '예정', ongoing: '진행중', completed: '종료' }
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

export default async function TournamentsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .order('start_date', { ascending: false })

  const tournaments = (data ?? []) as Tournament[]

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">대회 목록</h1>
        {tournaments.length === 0 ? (
          <p className="text-gray-400 text-center py-20">등록된 대회가 없습니다</p>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => (
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
      </main>
    </>
  )
}
