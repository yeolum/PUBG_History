'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TeamWithAliases } from '@/lib/types'
import SearchModal from '@/components/admin/SearchModal'
import CsvImportModal from '@/components/admin/CsvImportModal'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 w-full'

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
    const { data, error } = await supabase.from('teams').insert([{
      name: newTeam.name.trim(),
      short_name: newTeam.short_name.trim() || null,
      nationality: newTeam.nationality.trim() || null,
    }]).select('*, team_aliases(*)').single()
    if (!error && data) {
      setRows((rs) => [...rs, toRow(data as TeamWithAliases)])
      setNewTeam({ name: '', short_name: '', nationality: '' })
      setAddingNew(false)
    }
  }

  async function mergeTeam(targetId: string, targetName: string) {
    if (!mergeModal) return
    const fromId = mergeModal.fromId
    if (fromId === targetId) { setMergeModal(null); return }

    await supabase.from('team_aliases').upsert(
      [{ team_id: targetId, alias: mergeModal.fromName }],
      { onConflict: 'alias', ignoreDuplicates: true }
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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setCsvModal(true)}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-2 rounded-lg"
          >
            CSV Import
          </button>
          <button
            onClick={() => setAddingNew(true)}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg"
          >
            + New Team
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by team name or alias..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        <select
          value={filterNation}
          onChange={(e) => setFilterNation(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700"
        >
          <option value="">All Countries</option>
          {nations.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(search || filterNation) && (
          <button
            onClick={() => { setSearch(''); setFilterNation('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 border border-gray-200 rounded-lg"
          >
            Clear Filters
          </button>
        )}
        <span className="text-xs text-gray-400 self-center ml-1">{filtered.length} teams</span>
      </div>

      {addingNew && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Team Name *</label>
            <input value={newTeam.name} onChange={(e) => setNewTeam((n) => ({ ...n, name: e.target.value }))}
              placeholder="Team name" autoFocus className={INPUT_CLS + ' w-48'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Tag</label>
            <input value={newTeam.short_name} onChange={(e) => setNewTeam((n) => ({ ...n, short_name: e.target.value }))}
              placeholder="TAG" className={INPUT_CLS + ' w-24'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Country</label>
            <input value={newTeam.nationality} onChange={(e) => setNewTeam((n) => ({ ...n, nationality: e.target.value }))}
              placeholder="Korea" className={INPUT_CLS + ' w-28'} />
          </div>
          <button onClick={createTeam}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg h-9">
            Add
          </button>
          <button onClick={() => setAddingNew(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">Cancel</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-[auto_2fr_1fr_1fr_auto] gap-3 items-center px-4 py-3">
                <ImageUpload
                  currentUrl={row.logo_url}
                  storagePath={`teams/${row.id}/logo`}
                  onUpdate={(url) => updateLogo(row.id, url)}
                  shape="square"
                  size="sm"
                />
                <input
                  value={row.name}
                  onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Team name"
                />
                <input
                  value={row.short_name}
                  onChange={(e) => updateRow(row.id, 'short_name', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Tag"
                />
                <input
                  value={row.nationality}
                  onChange={(e) => updateRow(row.id, 'nationality', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Country"
                />
                <div className="flex gap-1.5 items-center">
                  {row._dirty && (
                    <button
                      onClick={() => saveRow(row)}
                      disabled={saving === row.id}
                      className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
                    >
                      {saving === row.id ? '...' : 'Save'}
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 border border-gray-200 rounded-lg"
                  >
                    {expandedId === row.id ? 'Hide' : 'Aliases'}
                    {row.aliases.length > 0 && ` (${row.aliases.length})`}
                  </button>
                  <button
                    onClick={() => setMergeModal({ fromId: row.id, fromName: row.name })}
                    className="text-xs text-blue-400 hover:text-blue-600 px-2 py-1.5 border border-blue-200 rounded-lg"
                  >
                    Merge
                  </button>
                  <button
                    onClick={() => deleteTeam(row.id, row.name)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 border border-red-200 rounded-lg"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expandedId === row.id && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <p className="text-xs font-medium text-gray-500 mb-2">Aliases / Former Names</p>
                  {row.aliases.length === 0 && (
                    <p className="text-xs text-gray-400 mb-2">No aliases registered</p>
                  )}
                  <div className="space-y-1.5 mb-3">
                    {row.aliases.map((a) => (
                      <div key={a.alias} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5">
                        <ImageUpload
                          currentUrl={a.logo_url}
                          storagePath={`teams/${row.id}/aliases/${a.alias}`}
                          onUpdate={(url) => updateAliasLogo(row.id, a.alias, url)}
                          shape="square"
                          size="sm"
                        />
                        <span className="text-xs text-gray-700 flex-1">{a.alias}</span>
                        <button
                          onClick={() => removeAlias(row.id, a.alias)}
                          className="text-gray-300 hover:text-red-500 text-sm leading-none px-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={row._aliasInput}
                      onChange={(e) => updateRow(row.id, '_aliasInput', e.target.value)}
                      placeholder="New alias"
                      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      onKeyDown={(e) => { if (e.key === 'Enter') addAlias(row) }}
                    />
                    <button onClick={() => addAlias(row)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg">
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && !loading && (
            <p className="text-gray-400 text-sm text-center py-10">
              {search ? 'No results found' : 'No teams registered'}
            </p>
          )}
        </div>
      )}

      {csvModal && (
        <CsvImportModal
          type="teams"
          onDone={() => load()}
          onClose={() => setCsvModal(false)}
        />
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
