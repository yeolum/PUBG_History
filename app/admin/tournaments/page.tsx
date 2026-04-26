import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import AdminTournamentListClient from '@/components/admin/AdminTournamentListClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tournament Management' }

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
      <AdminTournamentListClient tournaments={tournaments} />
    </div>
  )
}
