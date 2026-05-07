'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

const CIRCUITS = {
  Global: ['PGC', 'PGS', 'PNC'] as const,
  Regional: ['PWS', 'PEC', 'PAS', 'PCL', 'PTS', 'PVS', 'PMS'] as const,
}

export default function Header() {
  const [open, setOpen] = useState<null | 'Global' | 'Regional'>(null)
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
              <div className="absolute left-0 top-full mt-1 bg-white text-gray-700 rounded-lg shadow-lg border border-gray-200 py-1 min-w-[300px] flex z-30">
                <ul className="flex-1 border-r border-gray-100">
                  {(['Global', 'Regional'] as const).map((scope) => (
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
                <ul className="flex-1 py-0">
                  {CIRCUITS[open].map((tag) => (
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
