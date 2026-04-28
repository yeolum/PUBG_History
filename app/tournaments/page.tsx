import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import TournamentListClient from '@/components/TournamentListClient'

export const metadata: Metadata = { title: '대회 목록' }

export default async function TournamentsPage() {
  const supabase = createPublicClient()
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
        <TournamentListClient tournaments={tournaments} />
      </main>
    </>
  )
}
