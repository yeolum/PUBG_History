import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '관리자 대시보드' }

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const [
    { count: tourCount },
    { count: teamCount },
    { count: playerCount },
    { count: matchCount },
    { data: recentMatches },
  ] = await Promise.all([
    supabase.from('tournaments').select('*', { count: 'exact', head: true }),
    supabase.from('teams').select('*', { count: 'exact', head: true }),
    supabase.from('players').select('*', { count: 'exact', head: true }),
    supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'imported'),
    supabase
      .from('matches')
      .select('id, pubg_match_id, match_date, status, stages(name, series(name, tournaments(name)))')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">대시보드</h1>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="대회" value={tourCount ?? 0} href="/admin/tournaments" />
        <StatCard label="팀" value={teamCount ?? 0} href="/admin/teams" />
        <StatCard label="선수" value={playerCount ?? 0} href="/admin/players" />
        <StatCard label="임포트된 매치" value={matchCount ?? 0} />
      </div>

      {/* 최근 임포트된 매치 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">최근 매치</h2>
        {(recentMatches ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">임포트된 매치가 없습니다</p>
        ) : (
          <div className="space-y-2">
            {(recentMatches ?? []).map((m) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const s = (m.stages as any)
              const ser = s?.series
              const t = ser?.tournaments
              return (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t?.name ?? '-'}</p>
                    <p className="text-xs text-gray-400">{ser?.name} / {s?.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.match_date && (
                      <span className="text-xs text-gray-400">{new Date(m.match_date).toLocaleDateString('ko-KR')}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.status === 'imported' ? 'bg-green-100 text-green-700' :
                      m.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>{m.status}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 바로가기 */}
      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        <QuickLink href="/admin/tournaments/new" label="+ 새 대회 만들기" />
        <QuickLink href="/admin/teams" label="팀 관리" />
        <QuickLink href="/admin/players" label="선수 관리" />
      </div>
    </div>
  )
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
  return href ? <Link href={href} className="block hover:border-yellow-400 transition-colors">{inner}</Link> : inner
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm text-center rounded-xl py-3 px-4 transition-colors block">
      {label}
    </Link>
  )
}
