import { createClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '선수' }

export default async function PlayersPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('players')
    .select('*, teams(id, name, short_name)')
    .eq('is_active', true)
    .order('nickname')

  const players = data ?? []

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">선수</h1>
        {players.length === 0 ? (
          <p className="text-gray-400 text-center py-20">등록된 선수가 없습니다</p>
        ) : (
          <div className="grid gap-3">
            {players.map((p) => (
              <Link
                key={p.id}
                href={`/players/${p.id}`}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-yellow-400 hover:shadow-sm transition-all flex items-center gap-4"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                  {p.profile_pic ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.profile_pic} alt={p.nickname} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-gray-400">{p.nickname[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{p.nickname}</p>
                  {p.real_name && <p className="text-xs text-gray-500">{p.real_name}</p>}
                </div>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(p.teams as any) && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <span className="text-sm text-gray-500 shrink-0">{(p.teams as any).name}</span>
                )}
                {p.nationality && (
                  <span className="text-xs text-gray-400 shrink-0">{p.nationality}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
