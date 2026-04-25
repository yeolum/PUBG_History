'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Stage, Match, MatchTeamResult, MatchPlayerStat } from '@/lib/types'
import { getMapDisplayName } from '@/lib/pubg-api'
import { calcPlacementPts } from '@/lib/scoring'
import SearchModal from '@/components/admin/SearchModal'

const INPUT_CLS = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

interface MatchWithResults extends Match {
  match_team_results: (MatchTeamResult & { teams: { id: string; name: string } | null })[]
  match_player_stats: (MatchPlayerStat & { players: { id: string; nickname: string } | null })[]
}

interface ComputedStanding {
  key: string
  teamId: string | null
  teamName: string
  matchesPlayed: number
  totalPts: number
  totalPlacementPts: number
  lastMatchPts: number
  lastMatchPlacement: number
  lastMatchDamage: number
}

function computeStandings(matches: MatchWithResults[]): ComputedStanding[] {
  const imported = matches
    .filter((m) => m.status === 'imported')
    .sort((a, b) => a.order_num - b.order_num)

  const statMap = new Map<string, ComputedStanding & { lastMatchOrder: number }>()

  for (const match of imported) {
    for (const r of match.match_team_results) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      const placementPts = calcPlacementPts(r.placement ?? 99)
      const matchPts = placementPts + (r.total_kills ?? 0)
      const matchDamage = match.match_player_stats
        .filter((ps) => (ps.placement ?? -1) === (r.placement ?? -2))
        .reduce((s, ps) => s + Number(ps.damage_dealt ?? 0), 0)

      if (!statMap.has(key)) {
        statMap.set(key, {
          key,
          teamId: r.team_id ?? null,
          teamName: r.pubg_team_name ?? r.teams?.name ?? '?',
          matchesPlayed: 0,
          totalPts: 0,
          totalPlacementPts: 0,
          lastMatchOrder: -Infinity,
          lastMatchPts: 0,
          lastMatchPlacement: 99,
          lastMatchDamage: 0,
        })
      }

      const stat = statMap.get(key)!
      stat.matchesPlayed++
      stat.totalPts += matchPts
      stat.totalPlacementPts += placementPts

      if (match.order_num > stat.lastMatchOrder) {
        stat.lastMatchOrder = match.order_num
        stat.lastMatchPts = matchPts
        stat.lastMatchPlacement = r.placement ?? 99
        stat.lastMatchDamage = matchDamage
      }
    }
  }

  return [...statMap.values()].sort((a, b) => {
    if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
    if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
    if (b.lastMatchPts !== a.lastMatchPts) return b.lastMatchPts - a.lastMatchPts
    if (a.lastMatchPlacement !== b.lastMatchPlacement) return a.lastMatchPlacement - b.lastMatchPlacement
    return b.lastMatchDamage - a.lastMatchDamage
  })
}

export default function StageMatchesPage() {
  const { id: tournamentId, stageId } = useParams() as { id: string; stageId: string }
  const supabase = createClient()

  const [stage, setStage] = useState<Stage | null>(null)
  const [matches, setMatches] = useState<MatchWithResults[]>([])
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null)

  const [newMatchId, setNewMatchId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [linkModal, setLinkModal] = useState<{
    type: 'team' | 'player'
    targetName: string
    matchId: string
    rowId: string
  } | null>(null)

  const load = useCallback(async () => {
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('stages').select('*').eq('id', stageId).single(),
      supabase
        .from('matches')
        .select('*, match_team_results(*, teams(id, name)), match_player_stats(*, players(id, nickname))')
        .eq('stage_id', stageId)
        .order('order_num'),
    ])
    setStage(s as Stage)
    setMatches((m ?? []) as MatchWithResults[])
  }, [stageId, supabase])

  useEffect(() => { load() }, [load])

  const computedStandings = useMemo(() => computeStandings(matches), [matches])

  async function importMatch() {
    const matchId = newMatchId.trim()
    if (!matchId) return
    setImporting(true)
    setImportError('')
    try {
      const res = await fetch('/api/admin/pubg/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId, pubgMatchId: matchId }),
      })
      const result = await res.json()
      if (!res.ok) {
        setImportError(result.error ?? 'Import failed')
      } else {
        setNewMatchId('')
        load()
      }
    } catch {
      setImportError('Server error')
    } finally {
      setImporting(false)
    }
  }

  async function deleteMatch(matchId: string) {
    if (!confirm('Delete this match?')) return
    await supabase.from('matches').delete().eq('id', matchId)
    if (selectedMatch === matchId) setSelectedMatch(null)
    load()
  }

  async function linkTeam(matchId: string, teamResultId: string, teamId: string) {
    const row = matches
      .find((m) => m.id === matchId)
      ?.match_team_results.find((r) => r.id === teamResultId)

    await supabase.from('match_team_results').update({ team_id: teamId }).eq('id', teamResultId)

    if (row?.pubg_team_name) {
      await supabase.from('team_aliases').upsert(
        [{ team_id: teamId, alias: row.pubg_team_name }],
        { onConflict: 'alias', ignoreDuplicates: true }
      )
      await supabase
        .from('match_player_stats')
        .update({ team_id: teamId })
        .eq('match_id', matchId)
        .is('team_id', null)
        .eq('placement', row.placement ?? -1)
    }
    setLinkModal(null)
    load()
  }

  async function linkPlayer(matchId: string, statId: string, playerId: string) {
    const row = matches
      .find((m) => m.id === matchId)
      ?.match_player_stats.find((s) => s.id === statId)

    await supabase.from('match_player_stats').update({ player_id: playerId }).eq('id', statId)

    if (row?.pubg_player_name) {
      await supabase.from('player_aliases').upsert(
        [{ player_id: playerId, alias: row.pubg_player_name }],
        { onConflict: 'alias', ignoreDuplicates: true }
      )
    }
    setLinkModal(null)
    load()
  }

  if (!stage) return <div className="p-8 text-gray-400">Loading...</div>

  const selectedMatchData = matches.find((m) => m.id === selectedMatch)

  const perMatchStandings = selectedMatchData
    ? selectedMatchData.match_team_results
        .slice()
        .map((r) => ({
          ...r,
          placementPts: calcPlacementPts(r.placement ?? 99),
          killPts: r.total_kills ?? 0,
          matchPts: calcPlacementPts(r.placement ?? 99) + (r.total_kills ?? 0),
        }))
        .sort((a, b) => {
          if (b.matchPts !== a.matchPts) return b.matchPts - a.matchPts
          return (a.placement ?? 99) - (b.placement ?? 99)
        })
    : []

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href="/admin/tournaments" className="hover:text-gray-600">Tournaments</Link>
        <span>/</span>
        <Link href={`/admin/tournaments/${tournamentId}`} className="hover:text-gray-600">Tournament</Link>
        <span>/</span>
        <span className="text-gray-700">{stage.name}</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-2">{stage.name}</h1>
      <p className="text-sm text-gray-400 mb-8">
        {stage.type === 'group' ? 'Group Stage' : stage.type === 'playoff' ? 'Playoff' : 'Grand Final'}
      </p>

      {/* Cumulative Standings */}
      {computedStandings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
            <h2 className="font-semibold text-gray-800">Standings (Cumulative)</h2>
            <p className="text-xs text-gray-400 mt-0.5">Placement Pts + Kill Pts = Total | 1–8: 10,6,5,4,3,2,1,1</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-5 py-2">#</th>
                  <th className="text-left px-5 py-2">Team</th>
                  <th className="text-right px-5 py-2">Matches</th>
                  <th className="text-right px-5 py-2">Plc Pts</th>
                  <th className="text-right px-5 py-2">Kill Pts</th>
                  <th className="text-right px-5 py-2 font-bold text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {computedStandings.map((s, i) => (
                  <tr key={s.key} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-5 py-2 font-medium text-gray-800">
                      {s.teamName}
                      {!s.teamId && (
                        <span className="ml-1.5 text-xs text-orange-400 font-normal">(unlinked)</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.matchesPlayed}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.totalPlacementPts}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.totalPts - s.totalPlacementPts}</td>
                    <td className="px-5 py-2 text-right font-bold text-gray-900">{s.totalPts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
        <h2 className="font-semibold text-gray-800 mb-3">Add Match (PUBG Match ID)</h2>
        <div className="flex gap-2">
          <input
            value={newMatchId}
            onChange={(e) => setNewMatchId(e.target.value)}
            placeholder="PUBG Match ID (e.g. 12345678-abcd-...)"
            className={`flex-1 ${INPUT_CLS}`}
            onKeyDown={(e) => { if (e.key === 'Enter') importMatch() }}
          />
          <button
            onClick={importMatch}
            disabled={importing || !newMatchId.trim()}
            className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-gray-900 font-semibold text-sm px-5 py-2 rounded-lg"
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
        {importError && (
          <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</p>
        )}
      </div>

      {/* Match Tabs */}
      <h2 className="font-semibold text-gray-800 mb-3">Matches ({matches.length})</h2>
      {matches.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
          No matches imported yet
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {matches.map((match, i) => (
              <button
                key={match.id}
                onClick={() => setSelectedMatch(selectedMatch === match.id ? null : match.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  selectedMatch === match.id
                    ? 'bg-yellow-400 border-yellow-400 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'
                }`}
              >
                <span>M{i + 1}</span>
                {match.map && (
                  <span className="text-xs opacity-60">{getMapDisplayName(match.map)}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  match.status === 'imported' ? 'bg-green-100 text-green-700' :
                  match.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                }`}>{match.status}</span>
              </button>
            ))}
          </div>

          {selectedMatchData && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-800">
                    Match {matches.findIndex((m) => m.id === selectedMatchData.id) + 1}
                  </span>
                  {selectedMatchData.map && (
                    <span className="text-xs text-gray-400">{getMapDisplayName(selectedMatchData.map)}</span>
                  )}
                  {selectedMatchData.match_date && (
                    <span className="text-xs text-gray-400">
                      {new Date(selectedMatchData.match_date).toLocaleDateString('en-US')}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => deleteMatch(selectedMatchData.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>

              {selectedMatchData.status === 'error' && (
                <div className="px-5 py-3">
                  <p className="text-xs text-red-500">Error: {selectedMatchData.error_msg}</p>
                </div>
              )}

              {selectedMatchData.status === 'imported' && (
                <div className="p-5 grid gap-6 lg:grid-cols-2">
                  {/* Per-Match Team Scoreboard */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Team Results</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100">
                          <th className="text-left pb-1.5">#</th>
                          <th className="text-left pb-1.5">Team</th>
                          <th className="text-right pb-1.5">Plc</th>
                          <th className="text-right pb-1.5">Plc Pts</th>
                          <th className="text-right pb-1.5">Kill Pts</th>
                          <th className="text-right pb-1.5 font-bold text-gray-600">Total</th>
                          <th className="pb-1.5 w-12" />
                        </tr>
                      </thead>
                      <tbody>
                        {perMatchStandings.map((r, i) => (
                          <tr key={r.id} className="border-b border-gray-50 last:border-0">
                            <td className="py-1.5 text-gray-400 font-mono">{i + 1}</td>
                            <td className="py-1.5">
                              <span className={`font-medium ${r.team_id ? 'text-gray-800' : 'text-orange-600'}`}>
                                {r.pubg_team_name ?? r.teams?.name ?? '-'}
                              </span>
                              {r.team_id && r.teams?.name && r.pubg_team_name && r.pubg_team_name !== r.teams.name && (
                                <span className="ml-1 text-[10px] text-gray-400">→ {r.teams.name}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right text-gray-500">{r.placement}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.placementPts}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.killPts}</td>
                            <td className="py-1.5 text-right font-bold text-gray-900">{r.matchPts}</td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => setLinkModal({
                                  type: 'team',
                                  targetName: r.pubg_team_name ?? r.teams?.name ?? '',
                                  matchId: selectedMatchData.id,
                                  rowId: r.id,
                                })}
                                className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Player Stats */}
                  <div>
                    {(() => {
                      const unlinked = selectedMatchData.match_player_stats.filter((s) => !s.player_id)
                      const linked = selectedMatchData.match_player_stats.filter((s) => s.player_id)
                      const sorted = [
                        ...unlinked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                        ...linked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                      ]
                      return (
                        <>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Player Stats</p>
                            {unlinked.length > 0 && (
                              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
                                {unlinked.length} unlinked
                              </span>
                            )}
                          </div>
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-white">
                                <tr className="text-gray-400 border-b border-gray-100">
                                  <th className="text-left pb-1.5">Player (PUBG name)</th>
                                  <th className="text-right pb-1.5">Kills</th>
                                  <th className="text-right pb-1.5">Damage</th>
                                  <th className="pb-1.5 w-14" />
                                </tr>
                              </thead>
                              <tbody>
                                {sorted.map((s) => (
                                  <tr key={s.id} className={`border-b border-gray-50 last:border-0 ${!s.player_id ? 'bg-orange-50' : ''}`}>
                                    <td className="py-1">
                                      <div>
                                        <span className={`font-medium ${s.player_id ? 'text-gray-800' : 'text-orange-700'}`}>
                                          {s.pubg_player_name ?? '-'}
                                        </span>
                                        {s.player_id && s.players?.nickname !== s.pubg_player_name && (
                                          <span className="ml-1 text-gray-400">→ {s.players?.nickname}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-1 text-right text-gray-500">{s.kills}</td>
                                    <td className="py-1 text-right text-gray-500">{Number(s.damage_dealt).toFixed(0)}</td>
                                    <td className="py-1 text-right">
                                      <button
                                        onClick={() => setLinkModal({
                                          type: 'player',
                                          targetName: s.pubg_player_name ?? '',
                                          matchId: selectedMatchData.id,
                                          rowId: s.id,
                                        })}
                                        className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                                      >
                                        {s.player_id ? 'Edit' : 'Link'}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {linkModal && (
        <SearchModal
          type={linkModal.type}
          targetName={linkModal.targetName}
          onConfirm={(entityId, entityName) => {
            void entityName
            if (linkModal.type === 'team') {
              linkTeam(linkModal.matchId, linkModal.rowId, entityId)
            } else {
              linkPlayer(linkModal.matchId, linkModal.rowId, entityId)
            }
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  )
}
