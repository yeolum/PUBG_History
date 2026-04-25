'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SearchResult {
  id: string
  label: string
  sublabel?: string
}

interface SearchModalProps {
  type: 'team' | 'player'
  targetName: string
  subtext?: string
  onConfirm: (id: string, name: string) => void
  onClose: () => void
}

export default function SearchModal({ type, targetName, subtext, onConfirm, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const search = async () => {
      if (query.trim().length < 1) { setResults([]); return }
      setLoading(true)
      try {
        if (type === 'team') {
          const { data } = await supabase
            .from('teams')
            .select('id, name, short_name')
            .ilike('name', `%${query}%`)
            .limit(10)
          setResults((data ?? []).map((t) => ({
            id: t.id,
            label: t.name,
            sublabel: t.short_name ?? undefined,
          })))
        } else {
          const { data } = await supabase
            .from('players')
            .select('id, nickname, teams(name)')
            .ilike('nickname', `%${query}%`)
            .limit(10)
          setResults((data ?? []).map((p) => ({
            id: p.id,
            label: p.nickname,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sublabel: (p.teams as any)?.name ?? undefined,
          })))
        }
      } finally {
        setLoading(false)
      }
    }
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [query, type, supabase])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Link {type === 'team' ? 'Team' : 'Player'}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Link <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-yellow-700">{targetName}</span> to an existing {type}
          </p>
          {subtext && (
            <p className="text-xs text-blue-600 mt-1">{subtext}</p>
          )}
        </div>

        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${type} name...`}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 mb-3"
        />

        <div className="min-h-[120px] max-h-60 overflow-y-auto">
          {loading && <p className="text-sm text-gray-400 py-4 text-center">Searching...</p>}
          {!loading && results.length === 0 && query.trim() && (
            <p className="text-sm text-gray-400 py-4 text-center">No results found</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onConfirm(r.id, r.label)}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-yellow-50 flex items-center justify-between group"
            >
              <span className="text-sm font-medium text-gray-800">{r.label}</span>
              {r.sublabel && (
                <span className="text-xs text-gray-400 group-hover:text-gray-600">{r.sublabel}</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
