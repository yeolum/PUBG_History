import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import type { Team } from '@/lib/types'
import type { Metadata } from 'next'
import TeamListClient from '@/components/TeamListClient'

export const metadata: Metadata = { title: '팀' }

export default async function TeamsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('teams')
    .select('*')
    .eq('is_active', true)
    .order('name')

  const teams = (data ?? []) as Team[]

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">팀</h1>
        <TeamListClient teams={teams} />
      </main>
    </>
  )
}
