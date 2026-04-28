import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
}
const STATUS_COLOR: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}

export default async function HomePage() {
  const supabase = createPublicClient()
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('*')
    .order('start_date', { ascending: false })
    .limit(20)

  const list = (tournaments ?? []) as Tournament[]
  const ongoing = list.filter((t) => t.status === 'ongoing')
  const upcoming = list.filter((t) => t.status === 'upcoming')
  const completed = list.filter((t) => t.status === 'completed')

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">PUBG History</h1>
          <p className="text-gray-500 mt-2">Tournament records, team and player profiles at a glance</p>
        </div>

        {ongoing.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Ongoing Tournaments
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ongoing.map((t) => <TournamentCard key={t.id} t={t} />)}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Upcoming Tournaments</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((t) => <TournamentCard key={t.id} t={t} />)}
            </div>
          </section>
        )}

        {completed.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Completed Tournaments</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {completed.map((t) => <TournamentCard key={t.id} t={t} />)}
            </div>
          </section>
        )}

        {list.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">No tournaments registered</p>
            <p className="text-sm mt-2">Add tournaments from the admin page</p>
          </div>
        )}
      </main>
    </>
  )
}

function TournamentCard({ t }: { t: Tournament }) {
  return (
    <Link href={`/tournaments/${t.id}`} className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[t.status]}`}>
          {STATUS_LABEL[t.status]}
        </span>
        {t.short_name && (
          <span className="text-xs text-gray-400 font-mono">{t.short_name}</span>
        )}
      </div>
      <h3 className="font-semibold text-gray-900 text-base leading-tight">{t.name}</h3>
      {t.region && <p className="text-sm text-gray-500 mt-1">{t.region}</p>}
      {(t.start_date || t.end_date) && (
        <p className="text-xs text-gray-400 mt-2">
          {t.start_date ?? '?'} ~ {t.end_date ?? '?'}
        </p>
      )}
      {t.prize_pool && (
        <p className="text-sm font-medium text-yellow-600 mt-2">{t.prize_pool}</p>
      )}
    </Link>
  )
}
