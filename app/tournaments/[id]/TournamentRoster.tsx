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
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (roster.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Participants</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {roster.map((team) => {
          const isOpen = expandedId === team.id
          return (
            <div key={team.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(isOpen ? null : team.id)}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-50 transition-colors gap-2"
              >
                <span className="text-xs font-medium text-gray-800 truncate">{team.name}</span>
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
