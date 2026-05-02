'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Stage, Match, MatchTeamResult, MatchPlayerStat } from '@/lib/types'
import { getMapDisplayName, stripTagPrefix } from '@/lib/pubg-api'
import { calcPlacementPtsWithRule, ruleFromStage, DEFAULT_RULE, type ScoringRuleConfig } from '@/lib/scoring'
import SearchModal from '@/components/admin/SearchModal'
import DisplayNameModal from '@/components/admin/DisplayNameModal'
import { revalidatePublic } from '@/lib/revalidate'

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
  wwcd: number
  totalPts: number
  totalPlacementPts: number
  lastMatchPts: number
  lastMatchPlacement: number
  lastMatchDamage: number
}

interface ImportRow {
  rowId: string
  matchId: string
  status: 'pending' | 'importing' | 'success' | 'error'
  errorMsg?: string
}

interface AdditionalPoint {
  stage_id: string
  team_name: string
  points: number
}

function computeStandings(matches: MatchWithResults[], rule: ScoringRuleConfig = DEFAULT_RULE, extraPts: Record<string, number> = {}): ComputedStanding[] {
  const imported = matches.filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
  const statMap = new Map<string, ComputedStanding & { lastMatchOrder: number; firstChickenOrder: number }>()
  for (const match of imported) {
    for (const r of match.match_team_results) {
      const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
      const placementPts = calcPlacementPtsWithRule(r.placement ?? 99, rule)
      const killPts = Math.round((r.total_kills ?? 0) * rule.kill_pts)
      const matchPts = placementPts + killPts
      const matchDamage = match.match_player_stats
        .filter(ps => (ps.placement ?? -1) === (r.placement ?? -2))
        .reduce((s, ps) => s + Number(ps.damage_dealt ?? 0), 0)
      if (!statMap.has(key)) {
        statMap.set(key, { key, teamId: r.team_id ?? null, teamName: r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '?', matchesPlayed: 0, wwcd: 0, totalPts: 0, totalPlacementPts: 0, lastMatchOrder: -Infinity, lastMatchPts: 0, lastMatchPlacement: 99, lastMatchDamage: 0, firstChickenOrder: Infinity })
      }
      const stat = statMap.get(key)!
      stat.matchesPlayed++
      if ((r.placement ?? 99) === 1) {
        stat.wwcd++
        if (match.order_num < stat.firstChickenOrder) stat.firstChickenOrder = match.order_num
      }
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
  for (const stat of statMap.values()) {
    stat.totalPts += extraPts[stat.teamName.toLowerCase()] ?? 0
  }

  const results = [...statMap.values()]
  if (rule.type === 'chicken') {
    return results.sort((a, b) => {
      if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd
      if (a.wwcd > 0 && b.wwcd > 0 && a.firstChickenOrder !== b.firstChickenOrder) return a.firstChickenOrder - b.firstChickenOrder
      if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
      if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
      return b.lastMatchDamage - a.lastMatchDamage
    })
  }
  return results.sort((a, b) => {
    if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts
    if (b.totalPlacementPts !== a.totalPlacementPts) return b.totalPlacementPts - a.totalPlacementPts
    if (b.lastMatchPts !== a.lastMatchPts) return b.lastMatchPts - a.lastMatchPts
    if (a.lastMatchPlacement !== b.lastMatchPlacement) return a.lastMatchPlacement - b.lastMatchPlacement
    return b.lastMatchDamage - a.lastMatchDamage
  })
}

let rowCounter = 0

export default function StageMatchesPage() {
  const { id: tournamentId, stageId } = useParams() as { id: string; stageId: string }
  const supabase = createClient()

  const [stage, setStage] = useState<Stage | null>(null)
  const [matches, setMatches] = useState<MatchWithResults[]>([])
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null)
  const [dragMatchId, setDragMatchId] = useState<string | null>(null)
  const [dragOverMatchId, setDragOverMatchId] = useState<string | null>(null)

  const [importRows, setImportRows] = useState<ImportRow[]>([{ rowId: 'r0', matchId: '', status: 'pending' }])
  const [anyImporting, setAnyImporting] = useState(false)
  const [advanceCount, setAdvanceCount] = useState(0)
  const [eliminateCount, setEliminateCount] = useState(0)
  const [savingRules, setSavingRules] = useState(false)

  const [linkModal, setLinkModal] = useState<
    | { phase: 1; type: 'team' | 'player'; pubgName: string; matchId: string; rowId: string }
    | { phase: 2; type: 'team' | 'player'; pubgName: string; matchId: string; rowId: string; entityId: string; entityName: string }
    | null
  >(null)

  const [additionalPoints, setAdditionalPoints] = useState<AdditionalPoint[]>([])
  const [addPtsOpen, setAddPtsOpen] = useState(false)
  const [addPtsRows, setAddPtsRows] = useState<{ teamName: string; points: string }[]>([])
  const [savingAddPts, setSavingAddPts] = useState(false)

  const load = useCallback(async () => {
    const [{ data: s }, { data: m }, { data: ap }] = await Promise.all([
      supabase.from('stages').select('*, scoring_rules(*)').eq('id', stageId).single(),
      supabase.from('matches').select('*, match_team_results(*, teams(id, name)), match_player_stats(*, players(id, nickname))').eq('stage_id', stageId).order('order_num'),
      supabase.from('stage_additional_points').select('stage_id, team_name, points').eq('stage_id', stageId),
    ])
    const stageData = s as Stage
    setStage(stageData)
    setAdvanceCount(stageData.advance_count ?? 0)
    setEliminateCount(stageData.eliminate_count ?? 0)
    setMatches((m ?? []) as MatchWithResults[])
    setAdditionalPoints((ap ?? []) as AdditionalPoint[])
  }, [stageId, supabase])

  useEffect(() => { load() }, [load])

  // Re-fetch admin state and invalidate the public cache so changes appear
  // immediately on the user-facing pages instead of waiting for the 30s
  // ISR / unstable_cache window.
  const reload = useCallback(() => {
    revalidatePublic({ tournamentId })
    return load()
  }, [tournamentId, load])

  const stageRule = useMemo(() => ruleFromStage(stage?.scoring_rules), [stage])
  const extraPtsMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const ap of additionalPoints) m[ap.team_name.toLowerCase()] = ap.points
    return m
  }, [additionalPoints])
  const computedStandings = useMemo(() => computeStandings(matches, stageRule, extraPtsMap), [matches, stageRule, extraPtsMap])

  function handleMatchIdPaste(e: React.ClipboardEvent<HTMLInputElement>, rowId: string) {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const extraRows: ImportRow[] = lines.slice(1).map(line => {
      rowCounter++
      return { rowId: `r${rowCounter}`, matchId: line, status: 'pending' }
    })
    setImportRows(rows => {
      const idx = rows.findIndex(r => r.rowId === rowId)
      if (idx === -1) return rows
      const next = [...rows]
      next[idx] = { ...next[idx], matchId: lines[0], status: 'pending', errorMsg: undefined }
      next.splice(idx + 1, 0, ...extraRows)
      return next
    })
  }

  function openAddPtsPanel() {
    const existing = new Map(additionalPoints.map(ap => [ap.team_name.toLowerCase(), ap.points]))
    const rows = computedStandings.map(s => ({
      teamName: s.teamName,
      points: String(existing.get(s.teamName.toLowerCase()) ?? 0),
    }))
    // Append saved teams not currently in standings
    for (const ap of additionalPoints) {
      if (!rows.find(r => r.teamName.toLowerCase() === ap.team_name.toLowerCase())) {
        rows.push({ teamName: ap.team_name, points: String(ap.points) })
      }
    }
    setAddPtsRows(rows)
    setAddPtsOpen(true)
  }

  async function saveAdditionalPoints() {
    setSavingAddPts(true)
    await supabase.from('stage_additional_points').delete().eq('stage_id', stageId)
    const toInsert = addPtsRows
      .filter(r => r.teamName.trim() && Number(r.points) !== 0)
      .map(r => ({ stage_id: stageId, team_name: r.teamName.trim(), points: Number(r.points) }))
    if (toInsert.length > 0) {
      await supabase.from('stage_additional_points').insert(toInsert)
    }
    setSavingAddPts(false)
    setAddPtsOpen(false)
    reload()
  }

  async function saveAdvancementRules() {
    setSavingRules(true)
    await supabase.from('stages').update({
      advance_count: advanceCount > 0 ? advanceCount : null,
      eliminate_count: eliminateCount > 0 ? eliminateCount : null,
    }).eq('id', stageId)
    setSavingRules(false)
    reload()
  }

  function addRow() {
    rowCounter++
    setImportRows(rows => [...rows, { rowId: `r${rowCounter}`, matchId: '', status: 'pending' }])
  }

  function removeRow(rowId: string) {
    setImportRows(rows => rows.filter(r => r.rowId !== rowId))
  }

  function updateRowMatchId(rowId: string, matchId: string) {
    setImportRows(rows => rows.map(r => r.rowId === rowId ? { ...r, matchId, status: 'pending', errorMsg: undefined } : r))
  }

  async function importAll() {
    const pending = importRows.filter(r => r.matchId.trim() && r.status === 'pending')
    if (pending.length === 0) return
    setAnyImporting(true)
    for (const row of pending) {
      setImportRows(rows => rows.map(r => r.rowId === row.rowId ? { ...r, status: 'importing' } : r))
      try {
        const res = await fetch('/api/admin/pubg/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageId, pubgMatchId: row.matchId.trim() }),
        })
        const result = await res.json()
        if (!res.ok) {
          setImportRows(rows => rows.map(r => r.rowId === row.rowId ? { ...r, status: 'error', errorMsg: result.error ?? 'Import failed' } : r))
        } else {
          setImportRows(rows => rows.map(r => r.rowId === row.rowId ? { ...r, status: 'success' } : r))
        }
      } catch {
        setImportRows(rows => rows.map(r => r.rowId === row.rowId ? { ...r, status: 'error', errorMsg: 'Server error' } : r))
      }
    }
    setAnyImporting(false)
    reload()
  }

  async function deleteMatch(matchId: string) {
    if (!confirm('Delete this match?')) return
    await supabase.from('matches').delete().eq('id', matchId)
    if (selectedMatch === matchId) setSelectedMatch(null)
    reload()
  }

  async function reorderMatches(fromId: string, toId: string) {
    if (fromId === toId) return
    const sorted = [...matches].sort((a, b) => a.order_num - b.order_num)
    const fromIdx = sorted.findIndex(m => m.id === fromId)
    const toIdx = sorted.findIndex(m => m.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    await Promise.all(reordered.map((m, i) =>
      supabase.from('matches').update({ order_num: i + 1 }).eq('id', m.id)
    ))
    reload()
  }

  async function linkTeam(matchId: string, teamResultId: string, teamId: string, displayName: string | null, pubgTeamName: string | null, entityName: string) {
    await supabase.from('match_team_results').update({ team_id: teamId, display_name: displayName }).eq('id', teamResultId)
    const row = matches.find(m => m.id === matchId)?.match_team_results.find(r => r.id === teamResultId)
    const aliasesToUpsert = [entityName, ...(displayName && displayName !== entityName ? [displayName] : [])]
    for (const alias of aliasesToUpsert) {
      await supabase.from('team_aliases').upsert([{ team_id: teamId, alias }], { onConflict: 'alias', ignoreDuplicates: true })
    }
    if (pubgTeamName) {
      await supabase.from('match_player_stats').update({ team_id: teamId }).eq('match_id', matchId).is('team_id', null).eq('placement', row?.placement ?? -1)
    }
    setLinkModal(null)
    reload()
  }

  async function linkPlayer(statId: string, playerId: string, displayName: string | null, pubgPlayerName: string | null, entityName: string) {
    // Update ALL stats with same pubg_player_name across the entire stage
    if (pubgPlayerName && matches.length > 0) {
      const matchIds = matches.map(m => m.id)
      await supabase.from('match_player_stats').update({ player_id: playerId, display_name: displayName })
        .in('match_id', matchIds).eq('pubg_player_name', pubgPlayerName)
    } else {
      await supabase.from('match_player_stats').update({ player_id: playerId, display_name: displayName }).eq('id', statId)
    }
    const aliasSet = new Set<string>([
      ...(pubgPlayerName ? [pubgPlayerName] : []),
      entityName,
      ...(displayName && displayName !== entityName ? [displayName] : []),
    ].filter(Boolean))
    for (const alias of aliasSet) {
      await supabase.from('player_aliases').upsert([{ player_id: playerId, alias }], { onConflict: 'player_id,alias', ignoreDuplicates: true })
    }
    setLinkModal(null)
    reload()
  }

  if (!stage) return <div className="p-8 text-gray-400">Loading...</div>

  const sortedMatches = [...matches].sort((a, b) => a.order_num - b.order_num)
  const selectedMatchData = matches.find(m => m.id === selectedMatch)

  const perMatchStandings = selectedMatchData
    ? selectedMatchData.match_team_results.slice()
        .map(r => {
          const pp = calcPlacementPtsWithRule(r.placement ?? 99, stageRule)
          const kp = Math.round((r.total_kills ?? 0) * stageRule.kill_pts)
          return { ...r, placementPts: pp, killPts: kp, matchPts: pp + kp }
        })
        .sort((a, b) => b.matchPts !== a.matchPts ? b.matchPts - a.matchPts : (a.placement ?? 99) - (b.placement ?? 99))
    : []

  const pendingCount = importRows.filter(r => r.matchId.trim() && r.status === 'pending').length

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
      <p className="text-sm text-gray-400 mb-4">
        {stage.type === 'group' ? 'Group Stage' : stage.type === 'playoff' ? 'Playoff' : 'Grand Final'}
      </p>

      {/* Advancement Rules */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-8 flex items-center gap-6 flex-wrap">
        <span className="text-sm font-semibold text-gray-700 mr-2">Advancement Rules</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-green-600 font-medium">▲ Advance</span>
          <input type="number" min="0" value={advanceCount}
            onChange={e => setAdvanceCount(Math.max(0, Number(e.target.value)))}
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-yellow-400" />
          <span className="text-gray-400 text-xs">teams</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-red-500 font-medium">▼ Eliminate</span>
          <input type="number" min="0" value={eliminateCount}
            onChange={e => setEliminateCount(Math.max(0, Number(e.target.value)))}
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-yellow-400" />
          <span className="text-gray-400 text-xs">teams</span>
        </label>
        <button onClick={saveAdvancementRules} disabled={savingRules}
          className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold px-3 py-1.5 rounded-lg">
          {savingRules ? 'Saving...' : 'Save'}
        </button>
        <span className="text-xs text-gray-400 ml-auto">0 = no rule</span>
      </div>

      {/* Cumulative Standings */}
      {computedStandings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800">Standings (Cumulative)</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {stageRule.placement_pts.map((p, i) => `${i + 1}위:${p}`).join(' · ')} | Kill×{stageRule.kill_pts}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {stage.scoring_rules && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stageRule.type === 'chicken' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {stage.scoring_rules.name}
                </span>
              )}
              <button
                onClick={openAddPtsPanel}
                className={`text-xs border rounded-lg px-2.5 py-1 transition-colors ${additionalPoints.length > 0 ? 'border-yellow-400 text-yellow-700 bg-yellow-50' : 'border-gray-200 text-gray-500 hover:border-yellow-300 hover:text-gray-700'}`}
              >
                {additionalPoints.length > 0 ? `+ Additional Pts (${additionalPoints.length})` : '+ Additional Pts'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-5 py-2">#</th>
                  <th className="text-left px-5 py-2">Team</th>
                  <th className="text-right px-5 py-2">Matches</th>
                  <th className="text-right px-5 py-2">WWCD</th>
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
                      {!s.teamId && <span className="ml-1.5 text-xs text-orange-400 font-normal">(unlinked)</span>}
                    </td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.matchesPlayed}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.wwcd}</td>
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

      {/* Additional Points Panel */}
      {addPtsOpen && (
        <div className="bg-white rounded-xl border border-yellow-200 p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">Additional Points</h2>
              <p className="text-xs text-gray-400 mt-0.5">매치 점수 외 추가 부여 점수 — Total Points에만 반영됩니다</p>
            </div>
            <button onClick={() => setAddPtsOpen(false)} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
          </div>

          <div className="space-y-2 mb-4 max-h-96 overflow-y-auto pr-1">
            {addPtsRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.teamName}
                  onChange={e => setAddPtsRows(rows => rows.map((r, j) => j === i ? { ...r, teamName: e.target.value } : r))}
                  placeholder="Team name / tag"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                />
                <input
                  type="number"
                  value={row.points}
                  onChange={e => setAddPtsRows(rows => rows.map((r, j) => j === i ? { ...r, points: e.target.value } : r))}
                  className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-yellow-400"
                />
                <button
                  onClick={() => setAddPtsRows(rows => rows.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-500 text-lg leading-none px-1 shrink-0"
                >×</button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setAddPtsRows(rows => [...rows, { teamName: '', points: '0' }])}
              className="text-xs border border-dashed border-gray-300 text-gray-400 hover:border-yellow-400 hover:text-yellow-600 px-2.5 py-1.5 rounded-lg"
            >
              + Add Team
            </button>
            <button
              onClick={saveAdditionalPoints}
              disabled={savingAddPts}
              className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold px-4 py-1.5 rounded-lg"
            >
              {savingAddPts ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setAddPtsOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk Import */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Add Matches (PUBG Match ID)</h2>
          <button onClick={addRow} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1">
            + Add Row
          </button>
        </div>

        <div className="space-y-2 mb-3">
          {importRows.map((row, i) => (
            <div key={row.rowId} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono w-8 shrink-0 text-right">M{i + 1}</span>
              <input
                value={row.matchId}
                onChange={e => updateRowMatchId(row.rowId, e.target.value)}
                onPaste={e => handleMatchIdPaste(e, row.rowId)}
                placeholder="PUBG Match ID (e.g. 12345678-abcd-...)"
                disabled={row.status === 'importing' || row.status === 'success'}
                className={`flex-1 ${INPUT_CLS} disabled:opacity-60`}
                onKeyDown={e => { if (e.key === 'Enter') importAll() }}
              />
              <div className="w-20 shrink-0 flex items-center gap-1">
                {row.status === 'importing' && <span className="text-xs text-blue-500">...</span>}
                {row.status === 'success' && <span className="text-xs text-green-600">✓ Done</span>}
                {row.status === 'error' && (
                  <span className="text-xs text-red-500 truncate" title={row.errorMsg}>{row.errorMsg}</span>
                )}
              </div>
              {importRows.length > 1 && row.status !== 'success' && (
                <button onClick={() => removeRow(row.rowId)} className="text-gray-300 hover:text-red-500 text-lg leading-none px-1 shrink-0">×</button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={importAll}
          disabled={anyImporting || pendingCount === 0}
          className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-gray-900 font-semibold text-sm px-5 py-2 rounded-lg"
        >
          {anyImporting ? 'Importing...' : `Import ${pendingCount > 0 ? pendingCount : ''} Match${pendingCount !== 1 ? 'es' : ''}`}
        </button>
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
            {sortedMatches.map((match, i) => (
              <div
                key={match.id}
                draggable
                onDragStart={() => setDragMatchId(match.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverMatchId(match.id) }}
                onDrop={() => {
                  if (dragMatchId && dragMatchId !== match.id) reorderMatches(dragMatchId, match.id)
                  setDragMatchId(null); setDragOverMatchId(null)
                }}
                onDragEnd={() => { setDragMatchId(null); setDragOverMatchId(null) }}
                className={`flex items-center gap-1 cursor-grab active:cursor-grabbing rounded-lg transition-all ${dragOverMatchId === match.id && dragMatchId !== match.id ? 'ring-2 ring-yellow-400' : ''}`}
              >
                <span className="text-gray-300 text-sm px-0.5 select-none">⠿</span>
                <button
                  onClick={() => setSelectedMatch(selectedMatch === match.id ? null : match.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selectedMatch === match.id
                      ? 'bg-yellow-400 border-yellow-400 text-gray-900'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'
                  }`}
                >
                  <span>M{i + 1}</span>
                  {match.map && <span className="text-xs opacity-60">{getMapDisplayName(match.map)}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    match.status === 'imported' ? 'bg-green-100 text-green-700' :
                    match.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>{match.status}</span>
                </button>
              </div>
            ))}
          </div>

          {selectedMatchData && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-800">
                    Match {sortedMatches.findIndex(m => m.id === selectedMatchData.id) + 1}
                  </span>
                  {selectedMatchData.map && <span className="text-xs text-gray-400">{getMapDisplayName(selectedMatchData.map)}</span>}
                  {selectedMatchData.match_date && (
                    <span className="text-xs text-gray-400">{new Date(selectedMatchData.match_date).toLocaleDateString('en-US')}</span>
                  )}
                </div>
                <button onClick={() => deleteMatch(selectedMatchData.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
              </div>

              {selectedMatchData.status === 'error' && (
                <div className="px-5 py-3">
                  <p className="text-xs text-red-500">Error: {selectedMatchData.error_msg}</p>
                </div>
              )}

              {selectedMatchData.status === 'imported' && (
                <div className="p-5 grid gap-6 lg:grid-cols-2">
                  {/* Team Results */}
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
                                {stripTagPrefix(r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '-')}
                              </span>
                              {r.team_id && r.teams?.name && (
                                <span className="ml-1 text-[10px] text-gray-400">→ {r.teams.name}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right text-gray-500">{r.placement}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.placementPts}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.killPts}</td>
                            <td className="py-1.5 text-right font-bold text-gray-900">{r.matchPts}</td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => setLinkModal({ phase: 1, type: 'team', pubgName: r.pubg_team_name ?? r.teams?.name ?? '', matchId: selectedMatchData.id, rowId: r.id })}
                                className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                              >Edit</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Player Stats */}
                  <div>
                    {(() => {
                      const unlinked = selectedMatchData.match_player_stats.filter(s => !s.player_id)
                      const linked = selectedMatchData.match_player_stats.filter(s => s.player_id)
                      const sorted = [
                        ...unlinked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                        ...linked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                      ]
                      return (
                        <>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Player Stats</p>
                            {unlinked.length > 0 && (
                              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">{unlinked.length} unlinked</span>
                            )}
                          </div>
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-white">
                                <tr className="text-gray-400 border-b border-gray-100">
                                  <th className="text-left pb-1.5">Player</th>
                                  <th className="text-right pb-1.5">Kills</th>
                                  <th className="text-right pb-1.5">Damage</th>
                                  <th className="pb-1.5 w-14" />
                                </tr>
                              </thead>
                              <tbody>
                                {sorted.map(s => (
                                  <tr key={s.id} className={`border-b border-gray-50 last:border-0 ${!s.player_id ? 'bg-orange-50' : ''}`}>
                                    <td className="py-1">
                                      <span className={`font-medium ${s.player_id ? 'text-gray-800' : 'text-orange-700'}`}>
                                        {s.display_name ?? s.pubg_player_name ?? '-'}
                                      </span>
                                      {s.player_id && s.players?.nickname && (
                                        <span className="ml-1 text-xs text-gray-400">→ {s.players.nickname}</span>
                                      )}
                                    </td>
                                    <td className="py-1 text-right text-gray-500">{s.kills}</td>
                                    <td className="py-1 text-right text-gray-500">{Number(s.damage_dealt).toFixed(0)}</td>
                                    <td className="py-1 text-right">
                                      <button
                                        onClick={() => setLinkModal({ phase: 1, type: 'player', pubgName: s.pubg_player_name ?? '', matchId: selectedMatchData.id, rowId: s.id })}
                                        className="text-xs text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                                      >{s.player_id ? 'Edit' : 'Link'}</button>
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

      {linkModal?.phase === 1 && (
        <SearchModal
          type={linkModal.type}
          targetName={linkModal.pubgName}
          onConfirm={(entityId, entityName) => setLinkModal({ ...linkModal, phase: 2, entityId, entityName })}
          onClose={() => setLinkModal(null)}
        />
      )}
      {linkModal?.phase === 2 && (
        <DisplayNameModal
          type={linkModal.type}
          entityId={linkModal.entityId}
          entityName={linkModal.entityName}
          pubgName={linkModal.pubgName}
          matchCount={1}
          onConfirm={(displayName) => {
            if (linkModal.type === 'team') {
              linkTeam(linkModal.matchId, linkModal.rowId, linkModal.entityId, displayName, linkModal.pubgName, linkModal.entityName)
            } else {
              linkPlayer(linkModal.rowId, linkModal.entityId, displayName, linkModal.pubgName, linkModal.entityName)
            }
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  )
}
