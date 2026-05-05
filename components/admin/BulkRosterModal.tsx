'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import SearchModal from './SearchModal'
import { getNameVariants } from '@/lib/scoring'

type Kind = 'team' | 'player'

interface Candidate {
  id: string
  label: string
  sublabel: string | null
  logo_url?: string | null
  nationalityCode?: string | null
  // For players: their current global team_id, snapshotted into tournament_players.team_id at save
  teamId?: string | null
}

interface ReviewRow {
  input: string
  candidate: Candidate | null
  status: 'matched' | 'ambiguous' | 'unmatched'
  alternatives: Candidate[]
}

interface Props {
  kind: Kind
  tournamentId: string
  // For player kind: pin all matched players to this tournament team_id on save.
  // Undefined for team kind, or for legacy "no specific team" use cases.
  forTeamId?: string
  existingIds: Set<string>
  onClose: () => void
  onSaved: () => void
}

// Supabase caps a single SELECT at 1000 rows by default (PostgREST
// `db-max-rows`), regardless of `.limit(N)`. Page through with .range
// until a short batch comes back so the matcher sees every player /
// alias, not just the first 1000.
const PAGE = 1000
async function fetchAll<T>(
  supabase: ReturnType<typeof createClient>,
  build: (q: ReturnType<ReturnType<typeof createClient>['from']>) => unknown,
  table: string,
): Promise<T[]> {
  const out: T[] = []
  let page = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = build(supabase.from(table)) as any
    const { data } = await q.range(page * PAGE, (page + 1) * PAGE - 1)
    const batch = (data ?? []) as T[]
    out.push(...batch)
    if (batch.length < PAGE) break
    page++
  }
  return out
}

function parseLines(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    // Tolerate Excel "name<TAB>extra" — keep only the first column
    const first = raw.split('\t')[0]
    const trimmed = first.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

export default function BulkRosterModal({ kind, tournamentId, forTeamId, existingIds, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [phase, setPhase] = useState<'input' | 'review'>('input')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pickerForIdx, setPickerForIdx] = useState<number | null>(null)
  const [aliasPickerForIdx, setAliasPickerForIdx] = useState<number | null>(null)
  const [registeringIdx, setRegisteringIdx] = useState<number | null>(null)

  async function findMatches() {
    const inputs = parseLines(text)
    if (inputs.length === 0) {
      setErr('Paste at least one name')
      return
    }
    setBusy(true)
    setErr('')

    try {
      if (kind === 'team') {
        const [teams, aliases] = await Promise.all([
          fetchAll<{ id: string; name: string; short_name: string | null; logo_url: string | null }>(
            supabase, (q) => q.select('id, name, short_name, logo_url').order('id'), 'teams',
          ),
          fetchAll<{ team_id: string; alias: string }>(
            supabase, (q) => q.select('team_id, alias').order('id'), 'team_aliases',
          ),
        ])

        const teamById = new Map<string, { id: string; name: string; short_name: string | null; logo_url: string | null }>()
        for (const t of teams) teamById.set(t.id, t)

        // Build "lowercased key → team_ids[]" map covering name, short_name, alias, tag-part of "TAG - Name"
        const byKey = new Map<string, Set<string>>()
        const addKey = (key: string, teamId: string) => {
          const k = key.trim().toLowerCase()
          if (!k) return
          if (!byKey.has(k)) byKey.set(k, new Set())
          byKey.get(k)!.add(teamId)
        }
        for (const t of teams) {
          addKey(t.name, t.id)
          if (t.short_name) addKey(t.short_name, t.id)
        }
        for (const a of aliases) {
          const alias = a.alias
          addKey(alias, a.team_id)
          const dashIdx = alias.indexOf(' - ')
          if (dashIdx !== -1) {
            addKey(alias.slice(0, dashIdx), a.team_id)
            addKey(alias.slice(dashIdx + 3), a.team_id)
          }
        }

        const reviewed: ReviewRow[] = inputs.map((input) => {
          const matchSet = byKey.get(input.toLowerCase()) ?? new Set<string>()
          const matchIds = [...matchSet]
          const candidates: Candidate[] = matchIds
            .map((tid) => teamById.get(tid))
            .filter((t): t is { id: string; name: string; short_name: string | null; logo_url: string | null } => !!t)
            .map((t) => ({ id: t.id, label: t.name, sublabel: t.short_name, logo_url: t.logo_url }))

          if (candidates.length === 0) {
            return { input, candidate: null, status: 'unmatched', alternatives: [] }
          }
          if (candidates.length === 1) {
            return { input, candidate: candidates[0], status: 'matched', alternatives: [] }
          }
          return { input, candidate: candidates[0], status: 'ambiguous', alternatives: candidates }
        })
        setRows(reviewed)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [players, aliases] = await Promise.all([
          fetchAll<any>(
            supabase, (q) => q.select('id, nickname, nationality_code, team_id, teams(name)').order('id'), 'players',
          ),
          fetchAll<{ player_id: string; alias: string }>(
            supabase, (q) => q.select('player_id, alias').order('id'), 'player_aliases',
          ),
        ])

        const playerById = new Map<string, { id: string; nickname: string; teamName: string | null; nationalityCode: string | null; teamId: string | null }>()
        for (const p of players) {
          const teamName = (p.teams?.name as string | null) ?? null
          playerById.set(p.id as string, {
            id: p.id as string,
            nickname: p.nickname as string,
            teamName,
            nationalityCode: (p.nationality_code as string | null) ?? null,
            teamId: (p.team_id as string | null) ?? null,
          })
        }

        // Single index keyed by every name variant — both the full name and
        // (for "TAG_Player" patterns) the after-underscore suffix. The same
        // helper is used at lookup time so a name with embedded underscores
        // like "JoShY-_-" still resolves either as itself or via a "TAG_…"
        // PUBG match name.
        const byVariant = new Map<string, Set<string>>()
        const addName = (name: string, playerId: string) => {
          for (const v of getNameVariants(name)) {
            if (!byVariant.has(v)) byVariant.set(v, new Set())
            byVariant.get(v)!.add(playerId)
          }
        }
        for (const p of players) addName(p.nickname as string, p.id as string)
        for (const a of aliases) addName(a.alias, a.player_id)

        const toCandidates = (ids: string[]): Candidate[] =>
          ids
            .map((id) => playerById.get(id))
            .filter((p): p is { id: string; nickname: string; teamName: string | null; nationalityCode: string | null; teamId: string | null } => !!p)
            .map((p) => ({ id: p.id, label: p.nickname, sublabel: p.teamName, nationalityCode: p.nationalityCode, teamId: p.teamId }))

        const reviewed: ReviewRow[] = inputs.map((input) => {
          // Try each variant of the input — full name first, then suffix.
          // Stop at the first variant that has any match; ambiguity within
          // that variant surfaces as 'ambiguous' so admin can re-pick.
          for (const v of getNameVariants(input)) {
            const ids = [...(byVariant.get(v) ?? [])]
            if (ids.length === 0) continue
            const cands = toCandidates(ids)
            if (cands.length === 1) return { input, candidate: cands[0], status: 'matched', alternatives: [] }
            return { input, candidate: cands[0], status: 'ambiguous', alternatives: cands }
          }
          return { input, candidate: null, status: 'unmatched', alternatives: [] }
        })
        setRows(reviewed)
      }
      setPhase('review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveAll() {
    const toSave = rows.filter((r) => r.candidate && !existingIds.has(r.candidate.id))
    if (toSave.length === 0) {
      setErr('Nothing to save — all matched rows are already registered or unmatched.')
      return
    }
    setBusy(true)
    setErr('')
    const table = kind === 'team' ? 'tournament_teams' : 'tournament_players'
    const idCol = kind === 'team' ? 'team_id' : 'player_id'
    let insertRows: Record<string, string | null>[]
    if (kind === 'team') {
      // Freeze the bulk-typed input as the per-tournament display_name so the
      // participants list keeps showing the period-correct team label even if
      // the team's global teams.name is later renamed.
      insertRows = toSave.map((r) => ({ tournament_id: tournamentId, team_id: r.candidate!.id, display_name: r.input }))
    } else {
      // Pin every saved player to the team that opened this picker. If no team
      // was specified (legacy call), fall back to the player's current global
      // team so older callers still produce a non-null team_id.
      insertRows = toSave.map((r) => ({
        tournament_id: tournamentId,
        player_id: r.candidate!.id,
        team_id: forTeamId ?? r.candidate!.teamId ?? null,
      }))
    }
    // Player rows update on conflict so re-adding the same player to a different
    // team actually moves them; team rows still stay idempotent.
    const { error } = await supabase.from(table).upsert(insertRows, {
      onConflict: `tournament_id,${idCol}`,
      ignoreDuplicates: kind === 'team',
    })
    setBusy(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    onSaved()
    onClose()
  }

  // Create a brand-new player from an unmatched row's input, then mark the row
  // matched so saveAll picks it up like a normal match.
  async function registerUnmatchedPlayer(idx: number) {
    if (kind !== 'player') return
    const row = rows[idx]
    if (!row || row.candidate) return
    setRegisteringIdx(idx)
    setErr('')
    try {
      const res = await fetch('/api/admin/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: row.input }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErr(`Register failed for "${row.input}": ${json.error ?? res.status}`)
        return
      }
      const newPlayer = json.data as { id: string; nickname: string; teams?: { name: string | null } | null; nationality_code?: string | null }
      const newCand: Candidate = {
        id: newPlayer.id,
        label: newPlayer.nickname,
        sublabel: newPlayer.teams?.name ?? null,
        nationalityCode: newPlayer.nationality_code ?? null,
        teamId: null,
      }
      setRows((rs) => rs.map((r, j) => j === idx
        ? { ...r, candidate: newCand, status: 'matched', alternatives: [] }
        : r
      ))
    } finally {
      setRegisteringIdx(null)
    }
  }

  // Attach the unmatched input as an alias to an existing player the admin
  // picks. Useful when a player simply renamed — keep their stats history.
  async function addAliasToExisting(idx: number, playerId: string, playerName: string) {
    const row = rows[idx]
    if (!row) return
    setBusy(true)
    setErr('')
    try {
      const { error: aliasErr } = await supabase.from('player_aliases').upsert(
        [{ player_id: playerId, alias: row.input }],
        { onConflict: 'alias', ignoreDuplicates: true },
      )
      if (aliasErr) {
        setErr(`Alias failed for "${row.input}": ${aliasErr.message}`)
        return
      }
      // Snapshot the picked player's current global team_id so saveAll can pin it.
      const { data } = await supabase.from('players').select('team_id, teams(name), nationality_code').eq('id', playerId).single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamId = ((data as any)?.team_id as string | null) ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamName = ((data as any)?.teams?.name as string | null) ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const natCode = ((data as any)?.nationality_code as string | null) ?? null
      setRows((rs) => rs.map((r, j) => j === idx
        ? {
            ...r,
            candidate: { id: playerId, label: playerName, sublabel: teamName, nationalityCode: natCode, teamId },
            status: 'matched',
            alternatives: [],
          }
        : r
      ))
    } finally {
      setBusy(false)
    }
  }

  const matchedCount = rows.filter((r) => r.candidate && !existingIds.has(r.candidate.id)).length
  const dupCount = rows.filter((r) => r.candidate && existingIds.has(r.candidate.id)).length
  const unmatchedCount = rows.filter((r) => !r.candidate).length
  const ambiguousCount = rows.filter((r) => r.status === 'ambiguous').length

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Bulk Add {kind === 'team' ? 'Teams' : 'Players'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {phase === 'input'
                ? 'Paste one name per line (Excel rows work — only the first column is used).'
                : 'Review the auto-matched rows. Click a row to change or remove it before saving.'}
            </p>
          </div>

          <div className="px-6 py-4 overflow-y-auto flex-1">
            {phase === 'input' ? (
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={kind === 'team' ? 'DNS Esports\nGen.G Esports\nDanawa e-sports\n...' : 'Heaven\nKill\nFlawless\n...'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-3 text-xs">
                  <span className="text-green-600 font-medium">✓ {matchedCount} ready</span>
                  {ambiguousCount > 0 && <span className="text-amber-600">⚠ {ambiguousCount} ambiguous</span>}
                  {dupCount > 0 && <span className="text-gray-400">— {dupCount} already in roster</span>}
                  {unmatchedCount > 0 && <span className="text-red-500">✕ {unmatchedCount} unmatched</span>}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-2 py-1.5">Input</th>
                      <th className="text-left px-2 py-1.5">Match</th>
                      <th className="text-right px-2 py-1.5 w-32">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const isDup = r.candidate && existingIds.has(r.candidate.id)
                      return (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-600 align-middle">{r.input}</td>
                          <td className="px-2 py-1.5 align-middle">
                            {r.candidate ? (
                              <div className="flex items-center gap-1.5">
                                {kind === 'team' && r.candidate.logo_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={r.candidate.logo_url} alt="" className="w-4 h-4 rounded object-contain border border-gray-100" />
                                ) : kind === 'player' && r.candidate.nationalityCode ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`https://flagcdn.com/w20/${r.candidate.nationalityCode.toLowerCase()}.png`}
                                    alt={r.candidate.nationalityCode}
                                    className="w-4 h-3 object-cover rounded-sm border border-gray-100"
                                  />
                                ) : (
                                  <span className="w-4 h-4 rounded-full bg-gray-100" />
                                )}
                                <span className="text-sm text-gray-800">{r.candidate.label}</span>
                                {r.candidate.sublabel && <span className="text-xs text-gray-400">{r.candidate.sublabel}</span>}
                                {r.status === 'ambiguous' && (
                                  <span className="text-[10px] text-amber-600 font-medium ml-1">⚠ ambiguous</span>
                                )}
                                {isDup && <span className="text-[10px] text-gray-400 ml-1">(already in roster)</span>}
                              </div>
                            ) : (
                              <span className="text-xs text-red-500">no match</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right align-middle">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {!r.candidate && kind === 'player' && (
                                <>
                                  <button
                                    onClick={() => registerUnmatchedPlayer(i)}
                                    disabled={registeringIdx === i || busy}
                                    title={`Create a new player "${r.input}" and link it to this row`}
                                    className="text-[11px] bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 disabled:opacity-50 rounded px-1.5 py-0.5"
                                  >
                                    {registeringIdx === i ? '...' : '+ Register'}
                                  </button>
                                  <button
                                    onClick={() => setAliasPickerForIdx(i)}
                                    disabled={busy}
                                    title={`Attach "${r.input}" as an alias to an existing player (renamed nick)`}
                                    className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded px-1.5 py-0.5"
                                  >
                                    ≡ Alias to…
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setPickerForIdx(i)}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >
                                {r.candidate ? 'Change' : 'Pick'}
                              </button>
                              <button
                                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                                className="text-xs text-gray-300 hover:text-red-400"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          </div>

          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            {phase === 'input' ? (
              <button
                onClick={findMatches}
                disabled={busy}
                className="px-4 py-2 text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold rounded-lg"
              >
                {busy ? 'Matching...' : 'Find Matches →'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setPhase('input')}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  ← Back
                </button>
                <button
                  onClick={saveAll}
                  disabled={busy || matchedCount === 0}
                  className="px-4 py-2 text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold rounded-lg"
                >
                  {busy ? 'Saving...' : `Save ${matchedCount} ${kind === 'team' ? 'team' : 'player'}${matchedCount === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {pickerForIdx !== null && (
        <SearchModal
          type={kind}
          targetName={rows[pickerForIdx]?.input ?? ''}
          onConfirm={async (entityId, entityName) => {
            // For players, snapshot their current global team_id so save can pin it
            let teamId: string | null = null
            if (kind === 'player') {
              const { data } = await supabase.from('players').select('team_id').eq('id', entityId).single()
              teamId = (data?.team_id as string | null) ?? null
            }
            setRows((rs) => rs.map((r, j) => j === pickerForIdx
              ? { ...r, candidate: { id: entityId, label: entityName, sublabel: null, teamId }, status: 'matched', alternatives: [] }
              : r
            ))
            setPickerForIdx(null)
          }}
          onClose={() => setPickerForIdx(null)}
        />
      )}
      {aliasPickerForIdx !== null && (
        <SearchModal
          type="player"
          targetName={rows[aliasPickerForIdx]?.input ?? ''}
          onConfirm={async (playerId, playerName) => {
            const idx = aliasPickerForIdx
            setAliasPickerForIdx(null)
            await addAliasToExisting(idx, playerId, playerName)
          }}
          onClose={() => setAliasPickerForIdx(null)}
        />
      )}
    </>
  )
}
