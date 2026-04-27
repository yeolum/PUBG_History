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
  description: string
  logo_url: string | null
  aliases: AliasEntry[]
  _aliasInput: string
  _dirty: boolean
}

function toRow(t: TeamWithAliases): Row {
  return {
    id: t.id,
    name: t.name,
    short_name: t.short_name ?? '',
    nationality: t.nationality ?? '',
    description: t.description ?? '',
    logo_url: t.logo_url ?? null,
    aliases: t.team_aliases?.map((a) => ({ alias: a.alias, logo_url: a.logo_url ?? null })) ?? [],
    _aliasInput: '',
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

  const [addingNew, setAddingNew] = useState(false)
  const [newTeam, setNewTeam] = useState({ name: '', short_name: '', nationality: '' })

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
    await supabase.from('teams').update({
      name: row.name.trim(),
      short_name: row.short_name.trim() || null,
      nationality: row.nationality.trim() || null,
      description: row.description.trim() || null,
      logo_url: row.logo_url,
    }).eq('id', row.id)
    setSaving(null)
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
    const alias = row._aliasInput.trim()
    if (!alias) return
    const { error } = await supabase.from('team_aliases').insert([{ team_id: row.id, alias }])
    if (!error) {
      setRows((rs) => rs.map((r) => r.id === row.id ? {
        ...r,
        aliases: [...r.aliases, { alias, logo_url: null }],
        _aliasInput: '',
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

  async function createTeam() {
    if (!newTeam.name.trim()) return
    const res = await fetch('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTeam.name.trim(),
        short_name: newTeam.short_name.trim() || null,
        nationality: newTeam.nationality.trim() || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) { alert('Failed to create team: ' + (json.error ?? res.status)); return }
    setRows((rs) => [...rs, toRow(json.data as TeamWithAliases)])
    setNewTeam({ name: '', short_name: '', nationality: '' })
    setAddingNew(false)
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
          <button onClick={() => setAddingNew(true)}
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

      {/* Add new team row */}
      {addingNew && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex gap-2 flex-wrap items-end">
          {[
            { label: 'Team Name *', key: 'name', ph: 'Team name', w: 'w-44' },
            { label: 'Tag', key: 'short_name', ph: 'TAG', w: 'w-20' },
            { label: 'Country', key: 'nationality', ph: 'Korea', w: 'w-28' },
          ].map(({ label, key, ph, w }) => (
            <div key={key}>
              <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
              <input
                value={newTeam[key as keyof typeof newTeam]}
                onChange={(e) => setNewTeam((n) => ({ ...n, [key]: e.target.value }))}
                placeholder={ph}
                autoFocus={key === 'name'}
                className={`border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-yellow-400 ${w}`}
              />
            </div>
          ))}
          <button onClick={createTeam}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-xs px-3 py-2 rounded-lg h-8">
            Add
          </button>
          <button onClick={() => setAddingNew(false)}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-2">Cancel</button>
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
                              {row.aliases.map((a) => (
                                <div key={a.alias} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1">
                                  <ImageUpload
                                    currentUrl={a.logo_url}
                                    storagePath={`teams/${row.id}/aliases/${a.alias}`}
                                    onUpdate={(url) => updateAliasLogo(row.id, a.alias, url)}
                                    shape="square" size="sm"
                                  />
                                  <span className="text-xs text-gray-700">{a.alias}</span>
                                  <button onClick={() => removeAlias(row.id, a.alias)}
                                    className="text-gray-300 hover:text-red-500 text-sm leading-none ml-0.5">×</button>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input
                                value={row._aliasInput}
                                onChange={(e) => updateRow(row.id, '_aliasInput', e.target.value)}
                                placeholder="New alias"
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
