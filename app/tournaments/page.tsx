import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import TournamentListClient from '@/components/TournamentListClient'

export const metadata: Metadata = { title: '대회 목록' }

export default async function TournamentsPage() {
  const supabase = createPublicClient()
  const PAGE = 1000
  const tournaments: Tournament[] = []
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (!data || data.length === 0) break
    tournaments.push(...(data as Tournament[]))
    if (data.length < PAGE) break
    page++
  }

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
