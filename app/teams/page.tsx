import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import type { Team } from '@/lib/types'
import type { Metadata } from 'next'

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
        {teams.length === 0 ? (
          <p className="text-gray-400 text-center py-20">등록된 팀이 없습니다</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {teams.map((team) => (
              <Link
                key={team.id}
                href={`/teams/${team.id}`}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-md transition-all"
              >
                <div className="mb-3 w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                  {team.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-lg font-bold text-gray-400">{team.name[0]}</span>
                  )}
                </div>
                <p className="font-semibold text-gray-900">{team.name}</p>
                {team.short_name && <p className="text-xs text-gray-400 font-mono mt-0.5">{team.short_name}</p>}
                {team.nationality && <p className="text-xs text-gray-500 mt-1">{team.nationality}</p>}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
