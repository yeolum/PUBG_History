import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import AdminTournamentListClient from '@/components/admin/AdminTournamentListClient'
import RefreshAllStatsButton from '@/components/admin/RefreshAllStatsButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tournament Management' }

async function fetchAllTournaments(supabase: Awaited<ReturnType<typeof createClient>>) {
  const PAGE = 1000
  const rows: Tournament[] = []
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .order('start_date', { ascending: false })
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (!data || data.length === 0) break
    rows.push(...(data as Tournament[]))
    if (data.length < PAGE) break
    page++
  }
  return rows
}

export default async function AdminTournamentsPage() {
  const supabase = await createClient()
  const tournaments = await fetchAllTournaments(supabase)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Tournament Management</h1>
        <div className="flex items-center gap-3">
          <RefreshAllStatsButton tournamentIds={tournaments.map(t => t.id)} />
          <Link
            href="/admin/tournaments/new"
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + New Tournament
          </Link>
        </div>
      </div>
      <AdminTournamentListClient tournaments={tournaments} />
    </div>
  )
}
