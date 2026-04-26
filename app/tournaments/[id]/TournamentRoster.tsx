'use client'

import { useState } from 'react'
import Link from 'next/link'

interface RosterPlayer {
  id: string
  nickname: string
  nationality: string | null
}

interface RosterTeam {
  id: string
  name: string
  logo_url: string | null
  players: RosterPlayer[]
}

interface Props {
  roster: RosterTeam[]
}

function getFlagEmoji(code: string | null): string {
  if (!code || code.length !== 2) return ''
  return code.toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  )
}

export default function TournamentRoster({ roster }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  if (roster.length === 0) return null

  const allExpanded = expandedIds.size === roster.length

  function toggleTeam(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(roster.map((t) => t.id)))
    }
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Participants</p>
        <button
          onClick={toggleAll}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-0.5"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {roster.map((team) => {
          const isOpen = expandedIds.has(team.id)
          return (
            <div key={team.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleTeam(team.id)}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-50 transition-colors gap-2"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {team.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.logo_url} alt="" className="w-4 h-4 rounded-full object-cover shrink-0 border border-gray-100" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-gray-100 shrink-0" />
                  )}
                  <span className="text-xs font-medium text-gray-800 truncate">{team.name}</span>
                </div>
                <svg
                  className={`w-3 h-3 text-gray-400 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="border-t border-gray-100">
                  {team.players.length > 0 ? (
                    team.players.map((p) => {
                      const flag = getFlagEmoji(p.nationality)
                      return (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 last:border-0">
                          {flag ? (
                            <span className="text-sm leading-none shrink-0">{flag}</span>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          <Link
                            href={`/players/${p.id}`}
                            className="text-xs text-gray-700 hover:text-yellow-600 font-medium truncate"
                          >
                            {p.nickname}
                          </Link>
                        </div>
                      )
                    })
                  ) : (
                    <p className="px-3 py-2 text-xs text-gray-400">No players linked</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
