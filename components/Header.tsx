'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type Scope = 'Global' | 'PCS' | 'Regional'

const GLOBAL_CIRCUITS = ['PGC', 'PGS', 'PNC'] as const

const PCS_CIRCUITS = [
  { label: 'Asia',     tag: 'PAS' },
  { label: 'APAC',     tag: 'APAC' },
  { label: 'Europe',   tag: 'PEC' },
  { label: 'Americas', tag: 'PCS-AMC' },
] as const

const REGIONAL_CIRCUITS = ['PWS', 'PEC', 'PAS', 'PCL', 'PTS', 'PVS', 'PMS'] as const

export default function Header() {
  const [open, setOpen] = useState<null | Scope>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <header className="bg-gray-900 text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-8">
        <Link href="/" className="text-lg font-bold tracking-tight text-yellow-400 hover:text-yellow-300">
          PUBG History
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/tournaments" className="text-sm text-gray-300 hover:text-white transition-colors">
            Tournaments
          </Link>
          <div ref={wrapRef} className="relative">
            <button
              onClick={() => setOpen((o) => (o ? null : 'Global'))}
              className="text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1"
              aria-haspopup="true"
              aria-expanded={open !== null}
            >
              Circuits
              <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {open && (
              <div className="absolute left-0 top-full mt-1 bg-white text-gray-700 rounded-lg shadow-lg border border-gray-200 py-1 min-w-[320px] flex z-30">
                {/* 왼쪽: 카테고리 */}
                <ul className="w-28 shrink-0 border-r border-gray-100">
                  {(['Global', 'PCS', 'Regional'] as const).map((scope) => (
                    <li key={scope}>
                      <button
                        onMouseEnter={() => setOpen(scope)}
                        onClick={() => setOpen(scope)}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${open === scope ? 'bg-gray-50 text-yellow-600 font-medium' : ''}`}
                      >
                        {scope}
                        <span className="text-gray-300">›</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {/* 오른쪽: 선택된 카테고리 항목 */}
                <ul className="flex-1 py-0">
                  {open === 'Global' && GLOBAL_CIRCUITS.map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/tournaments/circuits/${tag}`}
                        onClick={() => setOpen(null)}
                        className="block px-4 py-2 text-sm font-mono hover:bg-yellow-50 hover:text-yellow-700"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}

                  {open === 'PCS' && PCS_CIRCUITS.map((item) => (
                    <li key={item.tag}>
                      <Link
                        href={`/tournaments/circuits/${item.tag}`}
                        onClick={() => setOpen(null)}
                        className="block px-4 py-2 text-sm hover:bg-yellow-50 hover:text-yellow-700 flex items-center justify-between gap-3"
                      >
                        <span className="font-medium">{item.label}</span>
                        <span className="text-xs text-gray-400 font-mono shrink-0">{item.tag}</span>
                      </Link>
                    </li>
                  ))}

                  {open === 'Regional' && REGIONAL_CIRCUITS.map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/tournaments/circuits/${tag}`}
                        onClick={() => setOpen(null)}
                        className="block px-4 py-2 text-sm font-mono hover:bg-yellow-50 hover:text-yellow-700"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Link href="/teams" className="text-sm text-gray-300 hover:text-white transition-colors">
            Teams
          </Link>
          <Link href="/players" className="text-sm text-gray-300 hover:text-white transition-colors">
            Players
          </Link>
        </nav>
      </div>
    </header>
  )
}
