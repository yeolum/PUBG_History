import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 30
import Header from '@/components/Header'
import type { Team } from '@/lib/types'
import type { Metadata } from 'next'
import TeamListClient from '@/components/TeamListClient'

export const metadata: Metadata = { title: '팀' }

const PAGE = 1000

export default async function TeamsPage() {
  const supabase = createPublicClient()

  const allTeams: Team[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('teams')
      .select('*, team_aliases(alias)')
      .eq('is_active', true)
      .order('name')
      .range(offset, offset + PAGE - 1)
    if (!data || data.length === 0) break
    allTeams.push(...(data as Team[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">팀</h1>
        <TeamListClient teams={allTeams} />
      </main>
    </>
  )
}
