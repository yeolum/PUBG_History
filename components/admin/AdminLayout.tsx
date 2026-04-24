'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  { href: '/admin', label: '대시보드', exact: true },
  { href: '/admin/tournaments', label: '대회 관리' },
  { href: '/admin/teams', label: '팀 관리' },
  { href: '/admin/players', label: '선수 관리' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* 사이드바 */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-700">
          <Link href="/" className="text-yellow-400 font-bold text-base hover:text-yellow-300">
            PUBG History
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">관리자</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => {
            const isActive = n.exact ? pathname === n.href : pathname.startsWith(n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-yellow-500 text-gray-900' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
