'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TeamWithAliases } from '@/lib/types'
import SearchModal from '@/components/admin/SearchModal'
import CsvImportModal from '@/components/admin/CsvImportModal'
import ImageUpload from '@/components/admin/ImageUpload'
import Pagination from '@/components/Pagination'

const CELL = 'bg-transparent border border-transparent hover:border-gray-200 focus:border-yellow-400 focus:bg-white rounded px-1.5 py-1 text-xs focus:outline-none w-full transition-colors'

function navKey(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  }
  const d = delta[e.key]
  if (!d) return
  e.preventDefault()
  const el = document.querySelector<HTMLElement>(
    `[data-nav-row="${rowIdx + d[0]}"][data-nav-col="${colIdx + d[1]}"]`,
  )
  el?.focus()
}

interface AliasEntry {
  alias: string
  logo_url: string | null
}

interface Row {
  id: string
  name: string
  short_name: string
  nationality: string
  league: string
  description: string
  logo_url: string | null
  aliases: AliasEntry[]
  _aliasTag: string
  _aliasName: string
  _dirty: boolean
}

function parseAlias(alias: string): { tag: string; name: string | null } {
  const sep = alias.indexOf(' - ')
  if (sep === -1) return { tag: alias, name: null }
  return { tag: alias.slice(0, sep), name: alias.slice(sep + 3) }
}

function toRow(t: TeamWithAliases): Row {
  return {
    id: t.id,
    name: t.name,
    short_name: t.short_name ?? '',
    nationality: t.nationality ?? '',
    league: (t as unknown as { league?: string | null }).league ?? '',
    description: t.description ?? '',
    logo_url: t.logo_url ?? null,
    aliases: t.team_aliases?.map((a) => ({ alias: a.alias, logo_url: a.logo_url ?? null })) ?? [],
    _aliasTag: '',
    _aliasName: '',
    _dirty: false,
  }
}

export default function AdminTeamsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterNation, setFilterNation] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  interface NewRow { rowId: string; name: string; short_name: string; nationality: string; status: 'idle' | 'saving' | 'done' | 'error'; errorMsg?: string }
  const [bulkOpen, setBulkOpen] = useState(false)
  const [newRows, setNewRows] = useState<NewRow[]>([])
  function mkRow(): NewRow { return { rowId: String(Date.now() + Math.random()), name: '', short_name: '', nationality: '', status: 'idle' } }
  function openBulk() { setBulkOpen(true); setNewRows([mkRow()]) }
  function addBulkRow() { setNewRows((rs) => [...rs, mkRow()]) }
  function removeBulkRow(id: string) { setNewRows((rs) => rs.filter((r) => r.rowId !== id)) }
  function updateNewRow(id: string, key: string, val: string) { setNewRows((rs) => rs.map((r) => r.rowId === id ? { ...r, [key]: val } : r)) }

  const [csvModal, setCsvModal] = useState(false)
  const [mergeModal, setMergeModal] = useState<{ fromId: string; fromName: string } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('teams')
      .select('*, team_aliases(*)')
      .order('name')
    setRows((data ?? []).map((t) => toRow(t as TeamWithAliases)))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function updateRow(id: string, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [key]: value, _dirty: true } : r))
  }

  async function saveRow(row: Row) {
    setSaving(row.id)
    const { error } = await supabase.from('teams').update({
      name: row.name.trim(),
      short_name: row.short_name.trim() || null,
      nationality: row.nationality.trim() || null,
      league: row.league.trim() || null,
      description: row.description.trim() || null,
      logo_url: row.logo_url,
    }).eq('id', row.id)
    setSaving(null)
    if (error) {
      alert(`Save failed: ${error.message}\n\nIf this mentions "league", run the migration SQL in Supabase dashboard:\nALTER TABLE teams ADD COLUMN IF NOT EXISTS league TEXT;`)
      return
    }
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, _dirty: false } : r))
  }

  function updateLogo(id: string, url: string | null) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, logo_url: url, _dirty: true } : r))
  }

  async function updateAliasLogo(teamId: string, alias: string, url: string | null) {
    const { data, error } = await supabase
      .from('team_aliases')
      .update({ logo_url: url })
      .eq('team_id', teamId)
      .eq('alias', alias)
      .select('logo_url')
    if (error) { alert('Failed to save alias logo: ' + error.message); return }
    if (!data?.length) {
      alert('Alias logo could not be saved.\nLikely cause: missing UPDATE policy on team_aliases.\nRun the latest migration SQL in Supabase dashboard.')
      return
    }
    setRows((rs) => rs.map((r) => r.id === teamId ? {
      ...r,
      aliases: r.aliases.map((a) => a.alias === alias ? { ...a, logo_url: url } : a),
    } : r))
  }

  async function addAlias(row: Row) {
    const tag = row._aliasTag.trim()
    if (!tag) return
    const name = row._aliasName.trim()
    const alias = name ? `${tag} - ${name}` : tag
    const { error } = await supabase.from('team_aliases').insert([{ team_id: row.id, alias }])
    if (!error) {
      setRows((rs) => rs.map((r) => r.id === row.id ? {
        ...r,
        aliases: [...r.aliases, { alias, logo_url: null }],
        _aliasTag: '',
        _aliasName: '',
      } : r))
    } else {
      alert('Alias already exists or is linked to another team')
    }
  }

  async function removeAlias(teamId: string, alias: string) {
    await supabase.from('team_aliases').delete().eq('team_id', teamId).eq('alias', alias)
    setRows((rs) => rs.map((r) => r.id === teamId ? {
      ...r,
      aliases: r.aliases.filter((a) => a.alias !== alias),
    } : r))
  }

  async function deleteTeam(id: string, name: string) {
    if (!confirm(`Delete team "${name}"?`)) return
    await supabase.from('teams').delete().eq('id', id)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  async function saveAllBulk() {
    const pending = newRows.filter((r) => r.status === 'idle' && r.name.trim())
    if (!pending.length) return
    setNewRows((rs) => rs.map((r) => r.status === 'idle' && r.name.trim() ? { ...r, status: 'saving' } : r))
    await Promise.all(pending.map(async (nr) => {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nr.name.trim(),
          short_name: nr.short_name.trim() || null,
          nationality: nr.nationality.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNewRows((rs) => rs.map((r) => r.rowId === nr.rowId ? { ...r, status: 'error', errorMsg: json.error ?? String(res.status) } : r))
      } else {
        setNewRows((rs) => rs.map((r) => r.rowId === nr.rowId ? { ...r, status: 'done' } : r))
        setRows((rs) => [...rs, toRow(json.data as TeamWithAliases)])
      }
    }))
  }

  async function mergeTeam(targetId: string, targetName: string) {
    if (!mergeModal) return
    const fromId = mergeModal.fromId
    if (fromId === targetId) { setMergeModal(null); return }

    await supabase.from('team_aliases').upsert(
      [{ team_id: targetId, alias: mergeModal.fromName }],
      { onConflict: 'alias', ignoreDuplicates: true },
    )
    await supabase.from('match_team_results').update({ team_id: targetId }).eq('team_id', fromId)
    await supabase.from('match_player_stats').update({ team_id: targetId }).eq('team_id', fromId)
    await supabase.from('players').update({ team_id: targetId }).eq('team_id', fromId)
    await supabase.from('teams').delete().eq('id', fromId)

    setMergeModal(null)
    void targetName
    load()
  }

  const nations = [...new Set(rows.map((r) => r.nationality).filter(Boolean))].sort() as string[]

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      r.name.toLowerCase().includes(q) ||
      r.aliases.some((a) => a.alias.toLowerCase().includes(q))
    const matchNation = !filterNation || r.nationality === filterNation
    return matchSearch && matchNation
  })
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const thCls = 'px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
        <div className="flex gap-2">
          <button onClick={() => setCsvModal(true)}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-2 rounded-lg">
            CSV Import
          </button>
          <button onClick={openBulk}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg">
            + New Team
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by team name or alias..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        <select value={filterNation} onChange={(e) => { setFilterNation(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700">
          <option value="">All Countries</option>
          {nations.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(search || filterNation) && (
          <button onClick={() => { setSearch(''); setFilterNation('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 border border-gray-200 rounded-lg">
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400 self-center ml-1">{filtered.length} teams</span>
      </div>

      {/* Bulk add teams */}
      {bulkOpen && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-700">Bulk Add Teams</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-yellow-200">
                  <th className="text-left px-2 py-1 text-[11px] text-gray-500 font-semibold w-6">#</th>
                  <th className="text-left px-2 py-1 text-[11px] text-gray-500 font-semibold">Team Name *</th>
                  <th className="text-left px-2 py-1 text-[11px] text-gray-500 font-semibold w-24">Tag</th>
                  <th className="text-left px-2 py-1 text-[11px] text-gray-500 font-semibold">Country</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {newRows.map((nr, i) => (
                  <tr key={nr.rowId} className="border-b border-yellow-100 last:border-0">
                    <td className="px-2 py-1 text-gray-400 text-center">{i + 1}</td>
                    <td className="px-1 py-1">
                      <input value={nr.name} onChange={(e) => updateNewRow(nr.rowId, 'name', e.target.value)}
                        disabled={nr.status !== 'idle'}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-full min-w-[120px] disabled:opacity-50"
                        placeholder="Team name" autoFocus={i === 0} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={nr.short_name} onChange={(e) => updateNewRow(nr.rowId, 'short_name', e.target.value)}
                        disabled={nr.status !== 'idle'}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-20 uppercase disabled:opacity-50"
                        placeholder="TAG" />
                    </td>
                    <td className="px-1 py-1">
                      <input value={nr.nationality} onChange={(e) => updateNewRow(nr.rowId, 'nationality', e.target.value)}
                        disabled={nr.status !== 'idle'}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-full min-w-[80px] disabled:opacity-50"
                        placeholder="Korea" />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {nr.status === 'idle' && (
                        <button onClick={() => removeBulkRow(nr.rowId)} className="text-gray-300 hover:text-red-500 text-sm leading-none">×</button>
                      )}
                      {nr.status === 'saving' && <span className="text-yellow-500 text-[10px]">···</span>}
                      {nr.status === 'done' && <span className="text-green-500 text-[10px]">✓</span>}
                      {nr.status === 'error' && <span className="text-red-500 text-[10px]" title={nr.errorMsg}>✗</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addBulkRow}
              className="text-xs border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded">
              + Add Row
            </button>
            <button onClick={saveAllBulk}
              disabled={!newRows.some((r) => r.status === 'idle' && r.name.trim())}
              className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-gray-900 font-semibold px-4 py-1.5 rounded">
              Save All
            </button>
            <button onClick={() => { setBulkOpen(false); setNewRows([]) }}
              className="text-xs text-gray-400 hover:text-gray-600 ml-auto">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className={thCls + ' w-8 text-center'}>#</th>
                    <th className={thCls + ' w-9'}>Logo</th>
                    <th className={thCls + ' min-w-[140px]'}>Name</th>
                    <th className={thCls + ' w-24'}>Tag</th>
                    <th className={thCls + ' min-w-[100px]'}>Country</th>
                    <th className={thCls + ' min-w-[100px]'}>League</th>
                    <th className={thCls + ' w-40 text-right'}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row, i) => (
                    <Fragment key={row.id}>
                      <tr className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/40 ${row._dirty ? 'bg-yellow-50/40' : ''}`}>
                        <td className="px-2 py-1 text-center text-gray-400 select-none">
                          {(page - 1) * pageSize + i + 1}
                        </td>
                        <td className="px-1 py-1">
                          <ImageUpload
                            currentUrl={row.logo_url}
                            storagePath={`teams/${row.id}/logo`}
                            onUpdate={(url) => updateLogo(row.id, url)}
                            shape="square"
                            size="sm"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.name}
                            onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 0)}
                            data-nav-row={i} data-nav-col={0}
                            className={CELL} placeholder="Team name" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.short_name}
                            onChange={(e) => updateRow(row.id, 'short_name', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 1)}
                            data-nav-row={i} data-nav-col={1}
                            className={CELL + ' uppercase'} placeholder="TAG" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.nationality}
                            onChange={(e) => updateRow(row.id, 'nationality', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 2)}
                            data-nav-row={i} data-nav-col={2}
                            className={CELL} placeholder="Korea" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.league}
                            onChange={(e) => updateRow(row.id, 'league', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 3)}
                            data-nav-row={i} data-nav-col={3}
                            className={CELL} placeholder="PGS" />
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex gap-1 justify-end items-center">
                            {row._dirty && (
                              <button onClick={() => saveRow(row)} disabled={saving === row.id}
                                className="text-[11px] bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-2 py-1 rounded whitespace-nowrap">
                                {saving === row.id ? '...' : 'Save'}
                              </button>
                            )}
                            <button
                              onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                              className={`text-[11px] px-1.5 py-1 border rounded whitespace-nowrap ${expandedId === row.id ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}
                            >
                              {row.aliases.length > 0 ? `alias(${row.aliases.length})` : 'alias'}
                            </button>
                            <button onClick={() => setMergeModal({ fromId: row.id, fromName: row.name })}
                              className="text-[11px] text-blue-400 hover:text-blue-600 px-1.5 py-1 border border-blue-200 rounded">
                              Merge
                            </button>
                            <button onClick={() => deleteTeam(row.id, row.name)}
                              className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-1 border border-red-200 rounded">
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedId === row.id && (
                        <tr>
                          <td colSpan={6} className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
                            <p className="text-[11px] font-semibold text-gray-400 mb-2 uppercase tracking-wide">Aliases / Former Names</p>
                            {row.aliases.length === 0 && (
                              <p className="text-xs text-gray-400 mb-2">No aliases</p>
                            )}
                            <div className="flex flex-wrap gap-2 mb-2">
                              {row.aliases.map((a) => {
                                const { tag, name } = parseAlias(a.alias)
                                return (
                                  <div key={a.alias} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1">
                                    <ImageUpload
                                      currentUrl={a.logo_url}
                                      storagePath={`teams/${row.id}/aliases/${a.alias}`}
                                      onUpdate={(url) => updateAliasLogo(row.id, a.alias, url)}
                                      shape="square" size="sm"
                                    />
                                    <span className="text-[11px] font-mono font-semibold bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{tag}</span>
                                    {name && <span className="text-xs text-gray-600">{name}</span>}
                                    <button onClick={() => removeAlias(row.id, a.alias)}
                                      className="text-gray-300 hover:text-red-500 text-sm leading-none ml-0.5">×</button>
                                  </div>
                                )
                              })}
                            </div>
                            <div className="flex gap-1.5 items-center flex-wrap">
                              <input
                                value={row._aliasTag}
                                onChange={(e) => updateRow(row.id, '_aliasTag', e.target.value)}
                                placeholder="TAG"
                                className="border border-gray-300 rounded px-2 py-1 text-xs w-20 focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono uppercase"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const next = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-alias-name]')
                                    next?.focus()
                                  }
                                }}
                              />
                              <span className="text-gray-400 text-xs">-</span>
                              <input
                                data-alias-name
                                value={row._aliasName}
                                onChange={(e) => updateRow(row.id, '_aliasName', e.target.value)}
                                placeholder="Full Name (optional)"
                                className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                onKeyDown={(e) => { if (e.key === 'Enter') addAlias(row) }}
                              />
                              <button onClick={() => addAlias(row)}
                                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2.5 py-1 rounded">
                                Add
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !loading && (
              <p className="text-gray-400 text-sm text-center py-10">
                {search ? 'No results found' : 'No teams registered'}
              </p>
            )}
          </div>
          <Pagination
            total={filtered.length} page={page} pageSize={pageSize}
            onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
          />
        </>
      )}

      {csvModal && (
        <CsvImportModal type="teams" onDone={() => load()} onClose={() => setCsvModal(false)} />
      )}
      {mergeModal && (
        <SearchModal
          type="team"
          targetName={mergeModal.fromName}
          onConfirm={(targetId, targetName) => mergeTeam(targetId, targetName)}
          onClose={() => setMergeModal(null)}
        />
      )}
    </div>
  )
}
