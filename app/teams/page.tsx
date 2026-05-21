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

  const [teamsResult, ttResult] = await Promise.all([
    (async () => {
      const all: Team[] = []
      let offset = 0
      while (true) {
        const { data } = await supabase
          .from('teams')
          .select('*, team_aliases(alias)')
          .eq('is_active', true)
          .order('name')
          .range(offset, offset + PAGE - 1)
        if (!data || data.length === 0) break
        all.push(...(data as Team[]))
        if (data.length < PAGE) break
        offset += PAGE
      }
      return all
    })(),
    supabase.from('tournament_teams').select('team_id, tournaments(end_date, start_date)').limit(5000),
  ])

  // 팀별 최근 대회 날짜 (end_date 우선, 없으면 start_date)
  const teamLatestDate: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (ttResult.data ?? []) as any[]) {
    if (!r.team_id) continue
    const t = Array.isArray(r.tournaments) ? r.tournaments[0] : r.tournaments
    const date: string | null = t?.end_date ?? t?.start_date ?? null
    if (!date) continue
    if (!teamLatestDate[r.team_id as string] || date > teamLatestDate[r.team_id as string]) {
      teamLatestDate[r.team_id as string] = date
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">팀</h1>
        <TeamListClient teams={teamsResult} teamLatestDate={teamLatestDate} />
      </main>
    </>
  )
}
