import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import type { Metadata } from 'next'
import PlayerListClient from '@/components/PlayerListClient'

export const metadata: Metadata = { title: '선수' }

const PAGE = 1000

export default async function PlayersPage() {
  const supabase = createPublicClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlayers: any[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('players')
      .select('*, teams(id, name, short_name, league)')
      .eq('is_active', true)
      .order('nickname')
      .range(offset, offset + PAGE - 1)
    if (!data || data.length === 0) break
    allPlayers.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">선수</h1>
        <PlayerListClient players={allPlayers} />
      </main>
    </>
  )
}
